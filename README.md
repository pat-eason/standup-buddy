# Standup Buddy

A web app for daily standups. Log a stream of consciousness through the day, tag it to projects, **collate** it into standup bullets with Claude Haiku 5.5, add notes while each point is discussed, **finalize** the standup into a summary, and ask an agent questions about all of your notes.

![The standup board with points, projects, discussion notes and meeting notes](docs/screenshots/standup-board.png)

## What it does

- **Stream.** Jot things down as they happen and tag each entry to one or more projects.
- **Collate.** One click turns the day's stream into four lists: updates, outstanding questions, decision points and a parking lot. Re-collating keeps anything you edited, checked off, annotated or added yourself.
- **Standup.** Run the meeting from the board. Check points off as they are discussed and add timestamped notes to each one, plus a free-form meeting notepad.
- **Finalize.** After the standup, the LLM folds your notes into a summary with decisions made, action items, follow-ups and carry-over. Copy it as Markdown.
- **Days.** Every day is stored on its own: its stream, collated points, notes and summary. Browse and search them under History.
- **Ask your notes.** A chat agent searches everything you have recorded and answers with the day cited. Conversations are multi-turn and persist.

![Finalized summary with decisions, action items and follow-ups](docs/screenshots/wrap-up.png)

![Chat popup answering a question from the recorded notes](docs/screenshots/chat.png)

## Run it

You need Docker. Then:

```bash
cp .env.example .env      # optional: set ANTHROPIC_API_KEY and change the secrets
docker compose up --build
```

Open <http://standup.buddy.localhost:8080> (or <http://localhost:8080>). Chrome resolves `*.localhost` to your machine with no hosts entry, and treats it as a secure origin, so there is no "Not secure" warning and the app can be installed. If you did not put a key in `.env`, add it under **Settings**. It is stored AES-256-GCM encrypted in Postgres, keyed by `APP_SECRET`.

The app has **no login** and is bound to `127.0.0.1` on purpose. Do not expose it to a network as is.

Stop it with `docker compose down`. Your data lives in the `pgdata` volume; add `-v` to wipe it.

## Install as an app (PWA)

Standup Buddy is an installable PWA: web manifest, icons and a service worker that keeps the UI shell available offline (data requests always go to the network).

1. Open **<http://standup.buddy.localhost:8080>** in Chrome.
2. Click **Install** in the address bar, or ⋮ → **Cast, save, and share** → **Install page as app**.

Use the `.localhost` address (or `localhost`) rather than a custom `*.local` name. Chrome only offers installation, and only hides the "Not secure" warning, on a secure origin, and plain-HTTP `*.local` hostnames are not one. They also hit a slow mDNS lookup on macOS. Installs from different addresses are separate apps, so pick one.

## Keyboard shortcuts

Single keys work anywhere except while typing in a field, so they never collide with browser shortcuts such as `⌘N`, `⌘T`, `⌘S` or `⌘J`. Press `?` in the app for the full list.

| Key | Action |
| --- | --- |
| `⌘/Ctrl` `K` or `C` | Toggle the chat |
| `N` or `/` | New stream note |
| `T` / `H` / `P` / `S` | Today / History / Projects / Settings |
| `[` / `]` | Previous / next day |
| `1` `2` `3` | Stream / Standup / Wrap-up tab |
| `Shift` `C` / `Shift` `F` | Collate day / Finalize standup |
| `?` | Show shortcuts |
| `Esc` | Close the chat or dialog, or leave a text field |

## Architecture

| Service | Tech | Role |
| --- | --- | --- |
| `web` | React 19 + Vite, `@flue/react`, nginx | UI; nginx proxies `/api` and `/agents` |
| `api` | Go (`net/http`, pgx) | All data, prompts, settings and search; migrations run on every start |
| `agent` | Node, [Flue](https://flueframework.com) 2.3 | LLM agents: collator, finalizer and the multi-turn notes assistant |
| `db` | Postgres 17 | App data and Flue's conversation tables |

- **Collate and finalize.** The Go API builds the prompt from the day's data and calls the agent service. A Flue agent returns its result through a terminating tool call (`submit_collation`, `submit_summary`), which the API validates and saves.
- **Ask your notes.** The browser talks to the Flue `notes-assistant` agent directly through `useFlueAgent`. Its tools (`search_notes`, `get_day`, `list_days`, `list_projects`) call back into the Go API. Conversations are durable in Postgres.
- **Settings.** Model per task (default `claude-haiku-5-5`), thinking level, tool toggles, extra prompt instructions and the API key. The agent service re-reads them from the API on each request.
- **Layout.** Every view shares one content width. The sidebar collapses to an icon rail, and below tablet-portrait width the nav moves to the top.

Set `ANTHROPIC_BASE_URL` to route model calls through a gateway or proxy.

## Develop without Docker

```bash
docker compose up db -d                      # Postgres only (publish 5432 yourself if needed)
(cd api   && go run .)                       # :8080, DATABASE_URL / AGENT_URL via env
(cd agent && npm install && npm run dev)     # :3000
(cd web   && npm install && npm run dev)     # :5173, proxies /api and /agents
```

## Repository layout

```
api/     Go API; SQL migrations in api/migrations (embedded, applied on start)
agent/   Flue app: src/agents/*, src/app.ts (routes), src/db.ts (Postgres adapter)
web/     React UI
docs/    Screenshots used in this README
```

## Notes

`@earendil-works/pi-ai` is pinned to 1.4.0 in `agent/package.json`: Flue 2.3.0 resolves a newer 1.5.x that no longer exports what it imports.
