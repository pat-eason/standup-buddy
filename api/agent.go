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
	hint    string // appended to "unreachable" errors
	http    *http.Client
}

func newAgentClient(baseURL, token, hint string) *AgentClient {
	return &AgentClient{baseURL: strings.TrimRight(baseURL, "/"), token: token, hint: hint, http: &http.Client{Timeout: 4 * time.Minute}}
}

type agentError struct{ msg string }

func (e agentError) Error() string { return e.msg }

// Run executes a one-shot agent ("collate", "finalize" or "recap") and returns its structured result.
// cfg is sent only to the Claude Code runner, which keeps no settings of its own.
func (a *AgentClient) Run(ctx context.Context, kind, runID, message string, cfg *AgentConfig) (json.RawMessage, error) {
	payload := map[string]any{"id": runID, "message": message}
	if cfg != nil {
		payload["config"] = cfg
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+"/run/"+kind, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-internal-token", a.token)
	res, err := a.http.Do(req)
	if err != nil {
		return nil, a.unreachable(err)
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

func (a *AgentClient) unreachable(err error) error {
	msg := "agent service unreachable: " + err.Error()
	if a.hint != "" {
		msg = a.hint
	}
	return agentError{msg}
}

// post sends a JSON request and returns the raw response; non-2xx becomes an agentError.
func (a *AgentClient) post(ctx context.Context, path string, payload any, timeout time.Duration) (*http.Response, error) {
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-internal-token", a.token)
	client := &http.Client{Timeout: timeout}
	res, err := client.Do(req)
	if err != nil {
		return nil, a.unreachable(err)
	}
	if res.StatusCode >= 300 {
		defer res.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		if e.Error == "" {
			e.Error = fmt.Sprintf("agent service returned %d", res.StatusCode)
		}
		return nil, agentError{e.Error}
	}
	return res, nil
}

// Test makes a tiny request on the Claude Code subscription.
func (a *AgentClient) Test(ctx context.Context, cfg AgentConfig) (string, error) {
	res, err := a.post(ctx, "/test", map[string]any{"config": cfg}, 60*time.Second)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var out struct {
		Reply string `json:"reply"`
	}
	_ = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&out)
	return out.Reply, nil
}

type chatTurn struct {
	Role string `json:"role"`
	Text string `json:"text"`
}

// Chat starts a streaming assistant reply; the caller reads NDJSON events from the body.
func (a *AgentClient) Chat(ctx context.Context, cfg AgentConfig, history []chatTurn, message string) (io.ReadCloser, error) {
	res, err := a.post(ctx, "/chat", map[string]any{"config": cfg, "history": history, "message": message}, 0)
	if err != nil {
		return nil, err
	}
	return res.Body, nil
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

// requireLLM fails early when the configured provider cannot possibly run. The Claude Code
// runner reports its own problems (not running, not signed in) when it is called.
func (s *Server) requireLLM(ctx context.Context) error {
	st, err := s.cfg.Get(ctx)
	if err != nil {
		return err
	}
	if st.LLMProvider == providerClaudeCode {
		return nil
	}
	if key, _ := s.cfg.APIKey(ctx); key == "" {
		return bad("No Anthropic API key configured. Add one in Settings, or switch to the Claude Code subscription.")
	}
	return nil
}

// runAgent runs a one-shot agent on whichever provider is configured.
func (s *Server) runAgent(ctx context.Context, kind, runID, message string) (json.RawMessage, error) {
	st, err := s.cfg.Get(ctx)
	if err != nil {
		return nil, err
	}
	if st.LLMProvider == providerClaudeCode {
		return s.runner.Run(ctx, kind, runID, message, &AgentConfig{Settings: st})
	}
	return s.agent.Run(ctx, kind, runID, message, nil)
}

func (s *Server) collateDay(ctx context.Context, date string) error {
	if err := s.requireLLM(ctx); err != nil {
		return err
	}
	day, err := s.store.GetDay(ctx, date)
	if err != nil {
		return err
	}
	if day.Status == "finalized" {
		return bad("reopen the standup before collating again")
	}
	created, completed, err := s.store.TodosForDay(ctx, date)
	if err != nil {
		return err
	}
	if len(day.Entries) == 0 && len(created)+len(completed) == 0 {
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
	todoSection, err := s.todoPromptSection(ctx, date, nameByID)
	if err != nil {
		return err
	}
	b.WriteString(todoSection)
	b.WriteString("\nCollate this into the standup board and call submit_collation.")

	raw, err := s.runAgent(ctx, "collate", fmt.Sprintf("collate-%s-%d", date, time.Now().UnixMilli()), b.String())
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
	if err := s.requireLLM(ctx); err != nil {
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
	todoSection, err := s.todoPromptSection(ctx, date, nameByID)
	if err != nil {
		return err
	}
	b.WriteString(todoSection)
	if open, err := s.store.ListTodos(ctx); err == nil {
		lines := []string{}
		for _, t := range open {
			if !t.Done {
				lines = append(lines, todoLine(t, nameByID))
			}
		}
		if len(lines) > 0 {
			fmt.Fprintf(&b, "\nOpen todos already on the list (do not suggest these again):\n%s\n", strings.Join(lines, "\n"))
		}
	}
	activeProjects := []string{}
	for _, p := range projects {
		if !p.Archived {
			activeProjects = append(activeProjects, p.Name)
		}
	}
	fmt.Fprintf(&b, "\nProjects: %s\n", orDash(strings.Join(activeProjects, ", ")))
	fmt.Fprintf(&b, "\nFree-form meeting notes:\n%s\n\nWrite the finalized standup summary and call submit_summary.", notes)

	raw, err := s.runAgent(ctx, "finalize", fmt.Sprintf("finalize-%s-%d", date, time.Now().UnixMilli()), b.String())
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
	f.SuggestedTodos = cleanSuggestedTodos(f.SuggestedTodos)
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

// cleanSuggestedTodos drops blank titles and malformed due dates the model may emit.
func cleanSuggestedTodos(in []SuggestedTodo) []SuggestedTodo {
	out := make([]SuggestedTodo, 0, len(in))
	for _, t := range in {
		t.Title = clip(strings.TrimSpace(t.Title), 200)
		if t.Title == "" {
			continue
		}
		t.Description = strings.TrimSpace(t.Description)
		t.Project = strings.TrimSpace(t.Project)
		if validDate(t.DueDate) != nil {
			t.DueDate = ""
		}
		out = append(out, t)
	}
	return out
}
