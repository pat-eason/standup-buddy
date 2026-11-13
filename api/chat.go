package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// chatEvent is one NDJSON line from the Claude Code runner.
type chatEvent struct {
	Type    string          `json:"type"` // text | tool | done | error
	Delta   string          `json:"delta"`
	ID      string          `json:"id"`
	Name    string          `json:"name"`
	Input   json.RawMessage `json:"input"`
	State   string          `json:"state"`
	Message string          `json:"message"`
}

// chatParts folds the event stream into the message that gets stored: consecutive text
// deltas form one text part, and a tool call starts a new part.
type chatParts struct{ parts []ChatPart }

func (c *chatParts) apply(e chatEvent) {
	switch e.Type {
	case "text":
		if n := len(c.parts); n > 0 && c.parts[n-1].Type == "text" {
			c.parts[n-1].Text += e.Delta
		} else if e.Delta != "" {
			c.parts = append(c.parts, ChatPart{Type: "text", Text: e.Delta})
		}
	case "tool":
		for i := range c.parts {
			if c.parts[i].Type == "tool" && c.parts[i].ID == e.ID {
				c.parts[i].State = e.State
				return
			}
		}
		c.parts = append(c.parts, ChatPart{Type: "tool", ID: e.ID, Name: e.Name, Input: e.Input, State: e.State})
	}
}

// final drops blank text and settles tool calls that never reported back.
func (c *chatParts) final() []ChatPart {
	out := make([]ChatPart, 0, len(c.parts))
	for _, p := range c.parts {
		if p.Type == "text" && strings.TrimSpace(p.Text) == "" {
			continue
		}
		if p.Type == "tool" && p.State == "running" {
			p.State = "done"
		}
		out = append(out, p)
	}
	return out
}

// chatStream answers one message on the Claude Code subscription: it stores the user's
// message, relays the runner's NDJSON stream to the browser, then stores the reply.
func (s *Server) chatStream(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	threadID := r.PathValue("id")
	var b struct{ Content string }
	if err := decode(r, &b); err != nil {
		s.fail(w, r, err)
		return
	}
	content := strings.TrimSpace(b.Content)
	if content == "" {
		s.fail(w, r, bad("message is empty"))
		return
	}
	st, err := s.cfg.Get(ctx)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if st.LLMProvider != providerClaudeCode {
		s.fail(w, r, bad("this chat endpoint needs the Claude Code subscription provider"))
		return
	}
	if err := s.store.TouchThread(ctx, threadID, nil); err != nil { // 404 for an unknown thread
		s.fail(w, r, err)
		return
	}
	prior, err := s.store.ListChatMessages(ctx, threadID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	history := make([]chatTurn, 0, len(prior))
	for _, m := range prior {
		var sb strings.Builder
		for _, p := range m.Parts {
			if p.Type == "text" {
				sb.WriteString(p.Text)
			}
		}
		if t := strings.TrimSpace(sb.String()); t != "" {
			history = append(history, chatTurn{Role: m.Role, Text: t})
		}
	}

	body, err := s.runner.Chat(ctx, AgentConfig{Settings: st}, history, content)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	defer body.Close()
	if err := s.store.AddChatMessage(ctx, threadID, "user", []ChatPart{{Type: "text", Text: content}}); err != nil {
		s.fail(w, r, err)
		return
	}

	// A reply can take longer than the server-wide write timeout.
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{})
	w.Header().Set("content-type", "application/x-ndjson")
	w.Header().Set("cache-control", "no-cache")
	w.Header().Set("x-accel-buffering", "no")
	w.WriteHeader(http.StatusOK)
	_ = rc.Flush()

	var acc chatParts
	reader := bufio.NewReaderSize(body, 64<<10)
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			var e chatEvent
			if json.Unmarshal(line, &e) == nil {
				acc.apply(e)
				if e.Type == "error" {
					slog.Warn("chat failure", "requestId", reqID(r), "error", e.Message)
				}
				_, _ = w.Write(line)
				_ = rc.Flush()
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) && ctx.Err() == nil {
				slog.Warn("chat stream broke", "requestId", reqID(r), "error", err)
			}
			break
		}
	}
	// Keep what was produced even if the user pressed stop.
	if parts := acc.final(); len(parts) > 0 {
		if err := s.store.AddChatMessage(context.WithoutCancel(ctx), threadID, "assistant", parts); err != nil {
			slog.Error("saving chat reply failed", "requestId", reqID(r), "error", err)
		}
	}
}
