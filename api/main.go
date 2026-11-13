package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dbURL := env("DATABASE_URL", "postgres://standup:standup@localhost:5432/standup?sslmode=disable")
	appSecret := env("APP_SECRET", "")
	if appSecret == "" {
		appSecret = "dev-only-secret-change-me"
		slog.Warn("APP_SECRET is not set; the stored API key is encrypted with a development default")
	}

	pool, err := connect(ctx, dbURL)
	if err != nil {
		slog.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	// Check / generate the schema on every start.
	version, applied, err := migrate(ctx, pool)
	if err != nil {
		slog.Error("migration failed", "error", err)
		os.Exit(1)
	}
	slog.Info("database ready", "schemaVersion", version, "migrationsApplied", applied)

	store := &Store{pool: pool}
	srv := &Server{
		pool:  pool,
		store: store,
		cfg:   newConfig(store, appSecret, os.Getenv("ANTHROPIC_API_KEY")),
		agent: newAgentClient(env("AGENT_URL", "http://localhost:3000"), env("INTERNAL_TOKEN", "dev-internal-token"), ""),
		runner: newAgentClient(env("CLAUDE_CODE_AGENT_URL", "http://localhost:3100"), env("INTERNAL_TOKEN", "dev-internal-token"),
			"The Claude Code runner is not running. Check it with: docker compose ps claude-runner"),
		internalToken: env("INTERNAL_TOKEN", "dev-internal-token"),
		schemaVersion: version,
	}

	httpSrv := &http.Server{
		Addr:              ":" + env("PORT", "8080"),
		Handler:           srv.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		// Collate/finalize wait on an LLM, so the write timeout is generous.
		WriteTimeout: 5 * time.Minute,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdownCtx)
	}()

	slog.Info("api listening", "addr", httpSrv.Addr)
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
