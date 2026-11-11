package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// AgentClient talks to the Flue agent service. The agent service is a thin LLM
// runner: Go owns the data, builds the prompts and applies the structured results.
type AgentClient struct {
	baseURL string
	token   string
	http    *http.Client
}

func newAgentClient(baseURL, token string) *AgentClient {
	return &AgentClient{baseURL: strings.TrimRight(baseURL, "/"), token: token, http: &http.Client{Timeout: 4 * time.Minute}}
}

type agentError struct{ msg string }

func (e agentError) Error() string { return e.msg }

// Run executes a one-shot agent ("collate" or "finalize") and returns its structured result.
func (a *AgentClient) Run(ctx context.Context, kind, runID, message string) (json.RawMessage, error) {
	body, _ := json.Marshal(map[string]string{"id": runID, "message": message})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+"/run/"+kind, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-internal-token", a.token)
	res, err := a.http.Do(req)
	if err != nil {
		return nil, agentError{"agent service unreachable: " + err.Error()}
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	var out struct {
		Result json.RawMessage `json:"result"`
		Error  string          `json:"error"`
	}
	_ = json.Unmarshal(raw, &out)
	if res.StatusCode >= 300 || out.Error != "" {
		msg := out.Error
		if msg == "" {
			msg = fmt.Sprintf("agent service returned %d", res.StatusCode)
		}
		return nil, agentError{msg}
	}
	return out.Result, nil
}

// ---------------------------------------------------------------- collate

type collationResult struct {
	Points []struct {
		Kind     string   `json:"kind"`
		Text     string   `json:"text"`
		Group    string   `json:"group"`
		Why      string   `json:"why"`
		Projects []string `json:"projects"`
		Sources  []int64  `json:"sources"`
	} `json:"points"`
}

func (s *Server) requireKey(ctx context.Context) error {
	if key, _ := s.cfg.APIKey(ctx); key == "" {
		return bad("No Anthropic API key configured. Add one in Settings.")
	}
	return nil
}

func (s *Server) collateDay(ctx context.Context, date string) error {
	if err := s.requireKey(ctx); err != nil {
		return err
	}
	day, err := s.store.GetDay(ctx, date)
	if err != nil {
		return err
	}
	if day.Status == "finalized" {
		return bad("reopen the standup before collating again")
	}
	if len(day.Entries) == 0 {
		return bad("add some stream-of-consciousness entries first")
	}
	projects, err := s.store.ListProjects(ctx)
	if err != nil {
		return err
	}
	nameByID := map[int64]string{}
	idByName := map[string]int64{}
	active := []string{}
	for _, p := range projects {
		nameByID[p.ID] = p.Name
		idByName[strings.ToLower(p.Name)] = p.ID
		if !p.Archived {
			active = append(active, p.Name)
		}
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Date: %s\n", date)
	if len(active) == 0 {
		b.WriteString("Projects: (none defined)\n")
	} else {
		fmt.Fprintf(&b, "Projects: %s\n", strings.Join(active, ", "))
	}
	b.WriteString("\nStream of consciousness entries (id | time | projects | text):\n")
	entryProjects := map[int64][]int64{}
	valid := map[int64]bool{}
	for _, e := range day.Entries {
		names := []string{}
		for _, id := range e.ProjectIDs {
			names = append(names, nameByID[id])
		}
		tags := "-"
		if len(names) > 0 {
			tags = strings.Join(names, ", ")
		}
		text := strings.Join(strings.Fields(strings.ReplaceAll(e.Text, "\n", " / ")), " ")
		fmt.Fprintf(&b, "%d | %s | %s | %s\n", e.ID, e.CreatedAt.UTC().Format("15:04"), tags, text)
		entryProjects[e.ID] = e.ProjectIDs
		valid[e.ID] = true
	}
	kept := []string{}
	for _, p := range day.Points {
		if p.Origin != "ai" || p.Edited || p.Discussed || len(p.Notes) > 0 {
			kept = append(kept, fmt.Sprintf("- [%s] (group: %s) %s", p.Kind, orDash(p.Group), p.Text))
		}
	}
	if len(kept) > 0 {
		fmt.Fprintf(&b, "\nKept points already on the board (do not repeat):\n%s\n", strings.Join(kept, "\n"))
	} else {
		b.WriteString("\nKept points already on the board: none\n")
	}
	if groups := existingGroups(day.Points); len(groups) > 0 {
		fmt.Fprintf(&b, "\nGroups already in use (reuse these names where the theme matches): %s\n", strings.Join(groups, ", "))
	}
	b.WriteString("\nCollate this into the standup board and call submit_collation.")

	raw, err := s.agent.Run(ctx, "collate", fmt.Sprintf("collate-%s-%d", date, time.Now().UnixMilli()), b.String())
	if err != nil {
		return err
	}
	var out collationResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return agentError{"could not read the model's result: " + err.Error()}
	}
	points := make([]collatedPoint, 0, len(out.Points))
	for _, p := range out.Points {
		text := strings.TrimSpace(p.Text)
		if text == "" || !pointKinds[p.Kind] {
			continue
		}
		ids := map[int64]bool{}
		for _, n := range p.Projects {
			if id, ok := idByName[strings.ToLower(strings.TrimSpace(n))]; ok {
				ids[id] = true
			}
		}
		sources := []int64{}
		for _, src := range p.Sources {
			if valid[src] {
				sources = append(sources, src)
				for _, id := range entryProjects[src] {
					ids[id] = true
				}
			}
		}
		pids := make([]int64, 0, len(ids))
		for id := range ids {
			pids = append(pids, id)
		}
		points = append(points, collatedPoint{
			Kind:           p.Kind,
			Text:           text,
			Group:          clip(strings.TrimSpace(p.Group), 60),
			Rationale:      strings.TrimSpace(p.Why),
			ProjectIDs:     pids,
			SourceEntryIDs: sources,
		})
	}
	return s.store.ApplyCollation(ctx, date, points)
}

// --------------------------------------------------------------- finalize

func (s *Server) finalizeDay(ctx context.Context, date string) error {
	if err := s.requireKey(ctx); err != nil {
		return err
	}
	day, err := s.store.GetDay(ctx, date)
	if err != nil {
		return err
	}
	if len(day.Points) == 0 {
		return bad("collate the day before finalizing")
	}
	projects, err := s.store.ListProjects(ctx)
	if err != nil {
		return err
	}
	nameByID := map[int64]string{}
	for _, p := range projects {
		nameByID[p.ID] = p.Name
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Date: %s\n\nBoard with discussion notes:\n", date)
	for _, p := range day.Points {
		flag := p.Kind
		if p.Discussed {
			flag += ", discussed"
		}
		tags := []string{}
		for _, id := range p.ProjectIDs {
			tags = append(tags, nameByID[id])
		}
		tag := ""
		if len(tags) > 0 {
			tag = " (" + strings.Join(tags, ", ") + ")"
		}
		fmt.Fprintf(&b, "- [%s]%s %s\n", flag, tag, p.Text)
		if p.Rationale != "" {
			fmt.Fprintf(&b, "    context: %s\n", p.Rationale)
		}
		for _, n := range p.Notes {
			fmt.Fprintf(&b, "    note: %s\n", n.Text)
		}
	}
	notes := strings.TrimSpace(day.GeneralNotes)
	if notes == "" {
		notes = "(none)"
	}
	fmt.Fprintf(&b, "\nFree-form meeting notes:\n%s\n\nWrite the finalized standup summary and call submit_summary.", notes)

	raw, err := s.agent.Run(ctx, "finalize", fmt.Sprintf("finalize-%s-%d", date, time.Now().UnixMilli()), b.String())
	if err != nil {
		return err
	}
	var f Finalization
	if err := json.Unmarshal(raw, &f); err != nil {
		return agentError{"could not read the model's result: " + err.Error()}
	}
	if strings.TrimSpace(f.Headline) == "" && strings.TrimSpace(f.Summary) == "" {
		return errors.New("the model returned an empty summary")
	}
	return s.store.SaveFinalization(ctx, date, f)
}

func orDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "-"
	}
	return s
}

func existingGroups(points []Point) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, p := range points {
		g := strings.TrimSpace(p.Group)
		if g != "" && !seen[strings.ToLower(g)] {
			seen[strings.ToLower(g)] = true
			out = append(out, g)
		}
	}
	return out
}
