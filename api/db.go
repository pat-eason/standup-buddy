package main

import (
	"context"
	"embed"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// dbtx is satisfied by both *pgxpool.Pool and pgx.Tx so store functions work in either.
type dbtx interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// connect waits for Postgres to accept connections, then returns a pool.
func connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	var lastErr error
	for attempt := 1; attempt <= 30; attempt++ {
		pool, err := pgxpool.New(ctx, url)
		if err == nil {
			if err = pool.Ping(ctx); err == nil {
				return pool, nil
			}
			pool.Close()
		}
		lastErr = err
		slog.Warn("waiting for postgres", "attempt", attempt, "error", err)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return nil, fmt.Errorf("postgres unavailable: %w", lastErr)
}

// migrate applies every embedded migration that has not run yet. It is called on
// every start, so a fresh database is generated and an existing one is checked
// and brought up to date. A Postgres advisory lock keeps concurrent starts safe.
func migrate(ctx context.Context, pool *pgxpool.Pool) (version int, applied int, err error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer conn.Release()

	const lockID = 727274
	if _, err = conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, lockID); err != nil {
		return 0, 0, err
	}
	defer conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockID) //nolint:errcheck

	if _, err = conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version    INTEGER PRIMARY KEY,
		name       TEXT NOT NULL,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`); err != nil {
		return 0, 0, err
	}

	rows, err := conn.Query(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return 0, 0, err
	}
	done := map[int]bool{}
	for rows.Next() {
		var v int
		if err = rows.Scan(&v); err != nil {
			rows.Close()
			return 0, 0, err
		}
		done[v] = true
		if v > version {
			version = v
		}
	}
	rows.Close()

	entries, err := migrationFS.ReadDir("migrations")
	if err != nil {
		return 0, 0, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)

	for _, name := range names {
		num, perr := strconv.Atoi(strings.SplitN(name, "_", 2)[0])
		if perr != nil {
			return version, applied, fmt.Errorf("bad migration name %q", name)
		}
		if done[num] {
			continue
		}
		body, rerr := migrationFS.ReadFile("migrations/" + name)
		if rerr != nil {
			return version, applied, rerr
		}
		tx, terr := conn.Begin(ctx)
		if terr != nil {
			return version, applied, terr
		}
		if _, err = tx.Exec(ctx, string(body)); err == nil {
			_, err = tx.Exec(ctx, `INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`, num, name)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			return version, applied, fmt.Errorf("migration %s: %w", name, err)
		}
		if err = tx.Commit(ctx); err != nil {
			return version, applied, err
		}
		slog.Info("applied migration", "name", name)
		version, applied = num, applied+1
	}
	return version, applied, nil
}
