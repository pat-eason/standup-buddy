# Standup Buddy

Single-user daily-standup app: stream notes → LLM collation → standup board → finalized summary, plus todos, insights and a notes chat. See [README.md](README.md) for features and the user-facing docs.

## Backend language: Go

**Go is the primary backend language. Put new backend behavior in the Go API (`api/`).** That includes new endpoints, business logic, data access, background jobs and integrations such as the MCP server (`api/mcp.go`, served at `/mcp`).

- Do not add a new backend service in another language (Node, Python, …) without asking first. If a feature seems to need one, say why and let the user decide.
- The one exception is `agent/`: a Node service built on [Flue](https://flueframework.com) that hosts the LLM agents (collator, finalizer, recapper, notes assistant). It is a deliberate carve-out because Flue is a TypeScript framework. Keep it thin: the Go API builds prompts, validates results and owns all data; the agent service only runs models and calls back into the API. Don't grow business logic there.
- `web/` is the React UI only. It talks to the Go API through `web/src/api.ts` and holds no server logic.

## Layout

| Path | What |
| --- | --- |
| `api/` | Go API (`net/http`, pgx). Embedded SQL migrations in `api/migrations/`, applied on every start |
| `api/mcp.go` | MCP tools (official Go SDK), mounted at `/mcp`; calls `Store` and the jobs directly |
| `agent/` | Flue agent service (see above) |
| `web/` | React 19 + Vite UI, nginx proxies `/api`, `/agents` and `/mcp` |
| `docker-compose.yml` | `db`, `api`, `agent`, `web` |

## Go conventions (follow what is already in `api/`)

- One flat `package main`. Handlers are in `handlers.go` (routes via `Server.routes`, wrapped by `Server.handle`); data access is methods on `Store` (`store.go`, `todos.go`, `insights.go`).
- Errors: `bad(...)` for a 400 the caller can act on, `errNotFound` for 404, `agentError` for 502. Anything else is logged and returned as a generic "internal error". Never leak database errors to clients or MCP tools.
- Schema changes are a new numbered file in `api/migrations/`; never edit an applied migration.
- Dates are `YYYY-MM-DD` strings validated with `validDate`. "Today" is the API container's local time, set with `TZ`.
- Long LLM jobs (collate, finalize) go through `runDayJob`, which rejects a concurrent run for the same day and detaches from client disconnects.
- Logging is structured `slog` JSON. Never log keys, tokens or note text.
- When adding an MCP tool, register it in `newMCPServer` in `api/mcp.go`, return an object (not a bare array), and update the tool table in the README and `MCP_TOOLS` in `web/src/views/SettingsView.tsx`.

## Commands

```bash
docker compose up --build            # whole stack at http://localhost:8080
(cd api && go build ./... && go vet ./...)
(cd api && TEST_DATABASE_URL=postgres://standup:standup@localhost:5432/standup go test ./...)   # needs a disposable Postgres
(cd web && npm run build)            # typechecks, then builds
(cd agent && npm run typecheck)
```

`go build ./...` can drop an `api/api` binary; delete it, don't commit it.

## Things to know

- The app has no login and binds to `127.0.0.1` on purpose. Don't expose it; `MCP_TOKEN` optionally protects `/mcp`.
- The Anthropic API key lives AES-256-GCM encrypted in Postgres (keyed by `APP_SECRET`) or in `ANTHROPIC_API_KEY`; it is never returned by the API.
- The web app is a PWA: after rebuilding `web`, a stale service worker can serve the old UI. Unregister it and clear caches when checking a change in the browser.
- The dev database holds the user's real standups. When testing against the running stack, use a far-future date (for example 2099-01-01), and delete what you create.
- `@earendil-works/pi-ai` is pinned to 1.4.0 in `agent/package.json` (see README Notes).
