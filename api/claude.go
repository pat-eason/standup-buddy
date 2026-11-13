package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

// call posts to a runner endpoint and returns its JSON body.
func (a *AgentClient) call(ctx context.Context, path string, payload any, timeout time.Duration) (json.RawMessage, error) {
	res, err := a.post(ctx, path, payload, timeout)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	return raw, nil
}

// registerClaudeRoutes serves the Settings → "Set up Claude Code subscription" flow. The runner owns
// the login (it lives in its volume); these routes only relay, so the browser never talks to it.
func (s *Server) registerClaudeRoutes(mux *http.ServeMux) {
	h := s.handle
	mux.HandleFunc("GET /api/claude/status", h(func(r *http.Request) (any, error) {
		raw, err := s.runner.call(r.Context(), "/auth/status", map[string]any{}, 30*time.Second)
		var ae agentError
		if errors.As(err, &ae) {
			// A runner that is not up is a state to show, not an error toast.
			return map[string]any{"runner": false, "loggedIn": false, "message": ae.msg}, nil
		}
		if err != nil {
			return nil, err
		}
		var out map[string]any
		_ = json.Unmarshal(raw, &out)
		out["runner"] = true
		return out, nil
	}))
	mux.HandleFunc("POST /api/claude/login", h(func(r *http.Request) (any, error) {
		raw, err := s.runner.call(r.Context(), "/auth/login", map[string]any{}, 60*time.Second)
		if err != nil {
			return nil, err
		}
		return jsonRaw(raw), nil
	}))
	mux.HandleFunc("POST /api/claude/login/code", h(func(r *http.Request) (any, error) {
		var b struct{ Code string }
		if err := decode(r, &b); err != nil {
			return nil, err
		}
		raw, err := s.runner.call(r.Context(), "/auth/code", map[string]string{"code": b.Code}, 90*time.Second)
		if err != nil {
			return nil, err
		}
		return jsonRaw(raw), nil
	}))
	mux.HandleFunc("POST /api/claude/logout", h(func(r *http.Request) (any, error) {
		raw, err := s.runner.call(r.Context(), "/auth/logout", map[string]any{}, 30*time.Second)
		if err != nil {
			return nil, err
		}
		return jsonRaw(raw), nil
	}))
}
