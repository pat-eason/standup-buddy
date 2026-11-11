# Standup Buddy

A web app for daily standups. Log a stream of consciousness through the day, tag it to projects, **collate** it into standup bullets with Claude Haiku 5.5, add notes while each point is discussed, **finalize** the standup into a summary, and ask an agent questions about all of your notes.

| Service | Tech | Role |
| --- | --- | --- |
| `web` | React 19 + Vite, `@flue/react`, nginx | UI; nginx proxies `/api` and `/agents` |
| `api` | Go (`net/http`, pgx) | All data, prompts, settings, search; migrations run on every start |
| `agent` | Node, [Flue](https://flueframework.com) 2.3 | LLM agents: collator, finalizer, multi-turn notes assistant |
| `db` | Postgres 17 | App data and Flue's conversation tables |

## Run it

```bash
cp .env.example .env      # optional: set ANTHROPIC_API_KEY and change the secrets
docker compose up --build
```

Open <http://localhost:8080>. If you did not put a key in `.env`, add it under **Settings** (stored AES-256-GCM encrypted in Postgres, keyed by `APP_SECRET`).

The app has **no login** and is bound to `127.0.0.1` on purpose. Do not expose it to a network as is.

## How it works

- **Days.** Each day holds its stream entries (with project tags), collated points (updates, outstanding questions, decision points, parking lot), per-point notes, free-form meeting notes and the finalized summary.
- **Collate.** The Go API builds the prompt from the day's entries and calls the agent service. Flue's `Collator` agent returns the board through a terminating `submit_collation` tool call, which the API validates and saves. Re-collating keeps points you edited, checked off, annotated or added yourself.
- **Finalize.** Same pattern with the `Finalizer` agent: board plus notes in, headline, summary, decisions, action items, follow-ups and carry-over out.
- **Ask your notes.** `⌘K` opens a chat popup. The browser talks to the Flue `notes-assistant` agent directly through `useFlueAgent`. Its tools (`search_notes`, `get_day`, `list_days`, `list_projects`) call back into the Go API. Conversations are durable in Postgres and each can be resumed.
- **Settings.** Models per task (default `claude-haiku-5-5`), thinking level, tool toggles, extra prompt instructions and the API key. The agent service re-reads them from the API on each request.

Set `ANTHROPIC_BASE_URL` to route model calls through a gateway or proxy.

## Develop without Docker

```bash
docker compose up db -d                      # Postgres only (publish 5432 yourself if needed)
(cd api   && go run .)                       # :8080, DATABASE_URL / AGENT_URL via env
(cd agent && npm install && npm run dev)     # :3000
(cd web   && npm install && npm run dev)     # :5173, proxies /api and /agents
```

## Layout

```
api/     Go API, SQL migrations in api/migrations (embedded, applied on start)
agent/   Flue app: src/agents/*, src/app.ts (routes), src/db.ts (Postgres adapter)
web/     React UI
```

`@earendil-works/pi-ai` is pinned to 1.4.0 in `agent/package.json`: Flue 2.3.0 resolves a newer 1.5.x that no longer exports what it imports.
