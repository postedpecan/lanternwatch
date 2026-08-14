# Lanternwatch

Local-first observability for Codex and Claude Code agent workflows.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)

Lanternwatch makes multi-agent coding work visible. It captures lifecycle
events from Codex and Claude Code, correlates them into runs, shows live agent
status and runtimes, stores durable history in SQLite, and can export completed
runs as Obsidian-compatible Markdown.

The application is intentionally local: its server and ingestion API bind to
`127.0.0.1`, and activity data stays on the workstation.

## Highlights

- Live project, workflow, agent, runtime, diagnostic, and event-log views
- Historical runs and activity statistics backed by SQLite
- Codex and Claude Code lifecycle hook integrations
- Stable run, event, and agent-instance correlation across concurrent work
- Bounded API delivery with direct-to-SQLite fallback when the dashboard is off
- Stalled and interrupted run detection
- Optional Markdown exports for Obsidian or any filesystem-based notes workflow
- Configuration-preserving installers with timestamped backups
- Persistent light/dark theme with reduced-motion support

## Architecture

```mermaid
flowchart LR
    A[Codex hooks] --> R[Lifecycle reporter]
    B[Claude Code hooks] --> R
    R -->|dashboard online| API[Loopback event API]
    R -->|API unavailable| DB[(SQLite)]
    API --> DB
    DB --> LIVE[Live dashboard]
    DB --> HIST[Run history and statistics]
    DB --> MD[Markdown exports]
```

SQLite is the source of truth. Reporters first try the loopback API and fall
back to an idempotent local database write, so observability never blocks the
coding task it observes.

## Engineering details

- **Failure isolation:** hook delivery is detached, bounded, and non-blocking.
- **Idempotency:** stable event identifiers make retries safe.
- **Configuration safety:** installers merge hook definitions, preserve an
  existing Codex notifier, and back up every global file they modify.
- **Portable paths:** defaults resolve from the current user profile; storage,
  database, vault, Codex, Claude, Node, and runtime-config locations can be
  overridden.
- **Local privacy boundary:** the API is unauthenticated by design because it
  is loopback-only. It is not intended for public deployment.
- **Accessible UI:** responsive layouts, keyboard-friendly controls,
  persistent themes, and reduced-motion handling are built in.

## Tech stack

| Layer | Technology |
| --- | --- |
| Web application | Next.js 16 App Router, React 19, TypeScript 7 |
| Persistence | Built-in `node:sqlite` |
| Integration | Node.js lifecycle reporters and PowerShell installers |
| Export | Markdown notes with YAML front matter |
| Verification | Node test runner, TypeScript, Next.js production build |

## Quick start

### Requirements

- Windows and PowerShell
- Node.js 24 or newer
- npm

```powershell
git clone https://github.com/postedpecan/lanternwatch.git
cd lanternwatch
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open <http://127.0.0.1:3000>.

The default database is `%USERPROFILE%\.lanternwatch\guild.db`. Path settings
in `.env.local` are optional; set `LANTERNWATCH_VAULT_PATH` if you want the web
application to export completed runs as Markdown.

## Configuration

| Variable | Purpose |
| --- | --- |
| `LANTERNWATCH_STORAGE_ROOT` | Runtime state and lifecycle logs; defaults to `~/.lanternwatch` |
| `LANTERNWATCH_DB_PATH` | Explicit SQLite database file |
| `LANTERNWATCH_VAULT_PATH` | Optional Markdown/Obsidian export destination |
| `LANTERNWATCH_STALE_AFTER_SECONDS` | Idle time before an open run appears stalled; default `600` |
| `LANTERNWATCH_API_URL` | Reporter ingestion endpoint; defaults to the loopback API |
| `LANTERNWATCH_CONFIG_PATH` | Optional shared runtime configuration file |
| `LANTERNWATCH_RESEARCH_DB_PATH` | Technical Researcher/Market Intelligence Analyst research database; defaults to `<project>/.lanternwatch/research.db` |
| `LANTERNWATCH_RESEARCH_VAULT_PATH` | Research-note destination; defaults to `D:\VibeCoding\Vibe Coding\Wiki\Lanternwatch` |

The installers persist resolved paths to `~/.lanternwatch/config.json` so
background reporters and the dashboard can share the same locations.
Environment variables take precedence over that file.

## Research archive

Every terminal Technical Researcher or Market Intelligence Analyst investigation produces one structured
public-source record. The main agent passes that JSON package to:

```powershell
npm run research:capture -- --file .\path\to\research-result.json
```

SQLite is authoritative. A capture is inserted once by stable task ID, marked
`pending`, and then exported as a deterministic dated Markdown note. Export
failures leave a retryable `failed` row and print a sanitized warning without
discarding the research. The next capture retries all pending/failed notes;
manual retry is also available:

```powershell
npm run research:retry
```

Only public HTTP(S) sources are accepted. Notes contain YAML metadata, the
research question, executive summary, verified findings, caveats, source
links, and short supporting excerpts. Existing vault notes are never indexed
or backfilled, and complete webpages, raw prompts, private conversation,
credentials, commands, local paths, and reasoning traces are not stored.

## Connect lifecycle events

These commands modify global agent configuration. Each installer creates
timestamped backups and preserves unrelated hooks and notifier settings.
Review the scripts before running them.

### Codex

```powershell
npm run guild:install
```

The installer resolves `CODEX_HOME` or defaults to `~/.codex`, finds Node on
`PATH`, merges lifecycle hooks, and chains any existing Codex completion
notifier. After installation, start the Codex CLI in this project and use
`/hooks` to review and trust the definitions. Restart desktop or IDE hosts so
they reload the global configuration.

Custom locations can be passed directly:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-lanternwatch.ps1 `
  -StorageRoot "D:\Lanternwatch" `
  -VaultPath "D:\Notes"
```

### Claude Code

```powershell
npm run guild:install:claude
```

The Claude installer merges global lifecycle hooks into
`~/.claude/settings.json`, updates the global instructions, and preserves both
files before editing. Start a new Claude Code session afterward.

### Manual reporting

```powershell
npm run guild:report -- --status working --agent archivist --run-id example-run --project "C:\path\to\project" --message "Inspecting the project"
npm run guild:report -- --status complete --agent archivist --run-id example-run --project "C:\path\to\project" --message "Inspection complete" --run-complete
```

Persisted integrations can also send events to:

```text
POST http://127.0.0.1:3000/api/guild/events
```

`window.guildHall.push(...)` and `window.guildHall.start(...)` are browser-only
demo helpers. They update client state but do not persist events.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Create a production build |
| `npm run start` | Serve the production build on loopback |
| `npm test` | Run lifecycle, hook, diagnostic, and formatting tests |
| `npm run guild:report` | Submit a manual lifecycle event |
| `npm run guild:simulate` | Simulate lifecycle activity locally |
| `npm run guild:rehook` | Reinstall Codex hooks and reset trust records |
| `npm run research:capture -- --file <json>` | Persist and export one research result |
| `npm run research:retry` | Retry pending or failed research-note exports |
| `npm run build:sprites` | Rebuild optional sprite assets |

## Security model

Lanternwatch is a trusted local tool, not a hosted multi-user service. The
event, dashboard, and health routes do not authenticate requests and may expose
local activity or filesystem diagnostics. Keep the server bound to loopback;
do not expose it through a public host, tunnel, reverse proxy, or `0.0.0.0`
without first adding authentication and response redaction.

See [SECURITY.md](SECURITY.md) for reporting guidance.

## Project structure

```text
app/                  Next.js pages and local API routes
components/guild/     Live dashboard, history, diagnostics, and UI state
lib/server/           SQLite persistence, queries, statistics, and exports
scripts/              Lifecycle hooks, reporters, installers, and simulations
Agents/               Lanternwatch specialist role specifications
public/guild/          Runtime visual assets
```

## Verification

The public-ready release is verified with:

```powershell
npm test
npx tsc --noEmit
npm run build
```

## Project status

Lanternwatch is an active portfolio project optimized for a single Windows
workstation. Natural next steps are a redacted read-only demo mode, broader
cross-platform installers, and authenticated remote access.

Built by [@postedpecan](https://github.com/postedpecan).

## License

No open-source license has been selected yet. The source is publicly viewable,
but no reuse rights are granted until a license is added.
