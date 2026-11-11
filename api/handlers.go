package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	pool          *pgxpool.Pool
	store         *Store
	cfg           *Config
	agent         *AgentClient
	internalToken string
	schemaVersion int
	inflight      sync.Map // "collate:2026-11-11" -> struct{}
}

type ctxKey string

const reqIDKey ctxKey = "requestId"

// ------------------------------------------------------------------ helpers

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func decode(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		return bad("invalid JSON body: %v", err)
	}
	return nil
}

func pathID(r *http.Request, name string) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	if err != nil || id <= 0 {
		return 0, bad("invalid %s", name)
	}
	return id, nil
}

func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	var br badRequest
	var ae agentError
	switch {
	case errors.As(err, &br):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": br.msg})
	case errors.Is(err, errNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	case errors.As(err, &ae):
		slog.Warn("agent failure", "requestId", reqID(r), "error", ae.msg)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": ae.msg})
	default:
		slog.Error("request failed", "requestId", reqID(r), "path", r.URL.Path, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
	}
}

func reqID(r *http.Request) string {
	v, _ := r.Context().Value(reqIDKey).(string)
	return v
}

// handle wraps a handler that returns (value, error); a nil value responds 204.
func (s *Server) handle(fn func(r *http.Request) (any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		out, err := fn(r)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		if out == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeJSON(w, http.StatusOK, out)
	}
}

// ------------------------------------------------------------------- routes

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	h := s.handle

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.pool.Ping(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "db unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// days
	mux.HandleFunc("GET /api/days", h(func(r *http.Request) (any, error) { return s.store.ListDays(r.Context()) }))
	mux.HandleFunc("GET /api/days/{date}", h(func(r *http.Request) (any, error) { return s.store.GetDay(r.Context(), r.PathValue("date")) }))
	mux.HandleFunc("PUT /api/days/{date}/notes", h(func(r *http.Request) (any, error) {
		var b struct{ Text string }
		if err := decode(r, &b); err != nil {
			return nil, err
		}
		return nil, s.store.SetGeneralNotes(r.Context(), r.PathValue("date"), b.Text)
	}))
	mux.HandleFunc("POST /api/days/{date}/entries", h(func(r *http.Request) (any, error) {
		var b struct {
			Text       string  `json:"text"`
			ProjectIDs []int64 `json:"projectIds"`
		}
		if err := decode(r, &b); err != nil {
			return nil, err
		}
		return s.store.AddEntry(r.Context(), r.PathValue("date"), b.Text, b.ProjectIDs)
	}))
	mux.HandleFunc("POST /api/days/{date}/collate", h(func(r *http.Request) (any, error) {
		return s.runJob(r, "collate", s.collateDay)
	}))
	mux.HandleFunc("POST /api/days/{date}/finalize", h(func(r *http.Request) (any, error) {
		return s.runJob(r, "finalize", s.finalizeDay)
	}))
	mux.HandleFunc("POST /api/days/{date}/reopen", h(func(r *http.Request) (any, error) {
		if err := s.store.ReopenDay(r.Context(), r.PathValue("date")); err != nil {
			return nil, err
		}
		return s.store.GetDay(r.Context(), r.PathValue("date"))
	}))
	mux.HandleFunc("GET /api/days/{date}/markdown", func(w http.ResponseWriter, r *http.Request) {
		md, err := s.dayMarkdown(r.Context(), r.PathValue("date"))
		if err != nil {
			s.fail(w, r, err)
			return
		}
		w.Header().Set("content-type", "text/markdown; charset=utf-8")
		_, _ = w.Write([]byte(md))
	})
	mux.HandleFunc("POST /api/days/{date}/points", h(func(r *http.Request) (any, error) {
		var b struct {
			Kind       string  `json:"kind"`
			Text       string  `json:"text"`
			ProjectIDs []int64 `json:"projectIds"`
		}
		if err := decode(r, &b); err != nil {
			return nil, err
		}
		return nil, s.store.AddPoint(r.Context(), r.PathValue("date"), b.Kind, b.Text, b.ProjectIDs)
	}))

	// entries, points, notes
	mux.HandleFunc("PATCH /api/entries/{id}", h(func(r *http.Request) (any, error) {
		id, err := pathID(r, "id")
		if err != nil {
			return nil, err
		}
		var b struct {
			Text       string  `json:"text"`
			ProjectIDs []int64 `json:"projectIds"`
		}
		if err := decode(r, &b); err != nil {
			return nil, err
		}
		return nil, s.store.UpdateEntry(r.Context(), id, b.Text, b.ProjectIDs)
	}))
	mux.HandleFunc("DELETE /api/entries/{id}", h(func(r *http.Request) (any, error) {
		id, err := pathID(r, "id")
		if err != nil {
			return nil, err
		}
		return nil, s.store.DeleteEntry(r.Context(), id)
	}))
	mux.HandleFunc("PATCH /api/points/{id}", h(func(r *http.Request) (any, error) {
		id, err := pathID(r, "id")
		if err != nil {
			return nil, err
		}
		var p pointPatch
		if err := decode(r, &p); err != nil {
			return nil, err
		}
		return nil, s.store.UpdatePoint(r.Context(), id, p)
	}))
	mux.HandleFunc("DELETE /api/points/{id}", h(func(r *http.Request) (any, error) {
		id, err := pathID(r, "id")
		if err != nil {
			return nil, err
		}
		return nil, s.store.DeletePoint(r.Context(), id)
	}))
	mux.HandleFunc("POST /api/points/{id}/notes", h(func(r *http.Request) (any, error) {
		id, err := pathID(r, "id")
		if err != nil {
			return nil, err
		}
		var b struct{ Text string }
		if err := decode(r, &b); err != nil {
			return nil, err
		}
		return nil, s.store.AddNote(r.Context(), id, b.Text)
	}))
	mux.HandleFunc("PATCH /api/notes/{id}", h(func(r *http.Request) (any, error) {
		id, err := pathID(r, "id")
		if err != nil {
			return nil, err
		}
		var b struct{ Text string }
		if err := decode(r, &b); err != nil {
			return nil, err
		}
		return nil, s.store.UpdateNote(r.Context(), id, b.Text)
	}))
	mux.HandleFunc("DELETE /api/notes/{id}", h(func(r *http.Request) (any, error) {
		id, err := pathID(r, "id")
		if err != nil {
			return nil, err
		}
		return nil, s.store.DeleteNote(r.Context(), id)
	}))

	// projects
	mux.HandleFunc("GET /api/projects", h(func(r *http.Request) (any, error) { return s.store.ListProjects(r.Context()) }))
	mux.HandleFunc("POST /api/projects", h(func(r *http.Request) (any, error) {
		var b struct{ Name, Color string }
		if err := decode(r, &b); err != nil {
			return nil, err
		}
		return s.store.CreateProject(r.Context(), b.Name, b.Color)
	}))
	mux.HandleFunc("PATCH /api/projects/{id}", h(func(r *http.Request) (any, error) {
		id, err := pathID(r, "id")
		if err != nil {
			return nil, err
		}
		var p projectPatch
		if err := decode(r, &p); err != nil {
			return nil, err
		}
		return s.store.UpdateProject(r.Context(), id, p)
	}))
	mux.HandleFunc("DELETE /api/projects/{id}", h(func(r *http.Request) (any, error) {
		id, err := pathID(r, "id")
		if err != nil {
			return nil, err
		}
		return nil, s.store.DeleteProject(r.Context(), id)
	}))

	// search (also used by the agent's tools)
	mux.HandleFunc("GET /api/search", h(func(r *http.Request) (any, error) {
		q := r.URL.Query()
		limit, _ := strconv.Atoi(q.Get("limit"))
		return s.store.Search(r.Context(), searchOptions{
			Query: q.Get("q"), From: q.Get("from"), To: q.Get("to"), Project: q.Get("project"), Limit: limit,
		})
	}))

	// chat thread index (conversations themselves live in Flue's tables)
	mux.HandleFunc("GET /api/threads", h(func(r *http.Request) (any, error) { return s.store.ListThreads(r.Context()) }))
	mux.HandleFunc("POST /api/threads", h(func(r *http.Request) (any, error) { return s.store.CreateThread(r.Context()) }))
	mux.HandleFunc("PATCH /api/threads/{id}", h(func(r *http.Request) (any, error) {
		var b struct{ Title *string }
		if err := decode(r, &b); err != nil {
			return nil, err
		}
		return nil, s.store.TouchThread(r.Context(), r.PathValue("id"), b.Title)
	}))
	mux.HandleFunc("DELETE /api/threads/{id}", h(func(r *http.Request) (any, error) {
		return nil, s.store.DeleteThread(r.Context(), r.PathValue("id"))
	}))
	mux.HandleFunc("DELETE /api/threads", h(func(r *http.Request) (any, error) { return nil, s.store.ClearThreads(r.Context()) }))

	// settings
	mux.HandleFunc("GET /api/settings", h(func(r *http.Request) (any, error) { return s.cfg.View(r.Context()) }))
	mux.HandleFunc("PATCH /api/settings", h(func(r *http.Request) (any, error) {
		var p settingsPatch
		if err := decode(r, &p); err != nil {
			return nil, err
		}
		if _, err := s.cfg.Patch(r.Context(), p); err != nil {
			return nil, err
		}
		return s.cfg.View(r.Context())
	}))
	mux.HandleFunc("PUT /api/settings/api-key", h(func(r *http.Request) (any, error) {
		var b struct{ Key string }
		if err := decode(r, &b); err != nil {
			return nil, err
		}
		if err := s.cfg.SetAPIKey(r.Context(), b.Key); err != nil {
			return nil, err
		}
		return s.cfg.View(r.Context())
	}))
	mux.HandleFunc("POST /api/settings/test", h(func(r *http.Request) (any, error) {
		reply, err := s.cfg.TestKey(r.Context())
		if err != nil {
			return nil, agentError{err.Error()}
		}
		return map[string]string{"reply": reply}, nil
	}))
	mux.HandleFunc("GET /api/info", h(func(r *http.Request) (any, error) {
		var version string
		var size int64
		err := s.pool.QueryRow(r.Context(), `SELECT split_part(version(), ' on ', 1), pg_database_size(current_database())`).Scan(&version, &size)
		if err != nil {
			return nil, err
		}
		return map[string]any{"postgres": version, "dbSizeBytes": size, "schemaVersion": s.schemaVersion, "flue": "2.3.0"}, nil
	}))

	// internal: only the agent service calls this (not proxied by nginx)
	mux.HandleFunc("GET /internal/config", func(w http.ResponseWriter, r *http.Request) {
		if s.internalToken == "" || r.Header.Get("x-internal-token") != s.internalToken {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		cfg, err := s.cfg.Agent(r.Context())
		if err != nil {
			s.fail(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	})

	return s.middleware(mux)
}

// runJob executes a long LLM job, rejecting a second concurrent run for the same day.
func (s *Server) runJob(r *http.Request, name string, fn func(ctx context.Context, date string) error) (any, error) {
	date := r.PathValue("date")
	if err := validDate(date); err != nil {
		return nil, err
	}
	key := name + ":" + date
	if _, busy := s.inflight.LoadOrStore(key, struct{}{}); busy {
		return nil, bad("%s is already running for %s", name, date)
	}
	defer s.inflight.Delete(key)
	// Detach from client disconnects so a finished LLM call is still saved.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 4*time.Minute)
	defer cancel()
	if err := fn(ctx, date); err != nil {
		return nil, err
	}
	return s.store.GetDay(ctx, date)
}

// ---------------------------------------------------------------- middleware

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		buf := make([]byte, 6)
		_, _ = rand.Read(buf)
		id := hex.EncodeToString(buf)
		r = r.WithContext(context.WithValue(r.Context(), reqIDKey, id))
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		w.Header().Set("x-request-id", id)
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic", "requestId", id, "panic", rec)
				writeJSON(sw, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			}
			if r.URL.Path != "/healthz" {
				slog.Info("request", "requestId", id, "operation", r.Method+" "+r.URL.Path, "status", sw.status,
					"durationMs", time.Since(start).Milliseconds())
			}
		}()
		next.ServeHTTP(sw, r)
	})
}
