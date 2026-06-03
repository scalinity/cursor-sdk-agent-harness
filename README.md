# Orrery

**A local observatory for AI coding agents — built on the [Cursor SDK](https://cursor.com/docs/sdk/typescript) (`@cursor/sdk`).**

Orrery is not an IDE clone. Chat is one client; the product is the forensic SQLite event log, run replay through the same ingest path as live, honest micro-USD cost attribution, and live pipeline telemetry. The UI follows Cursor's clean design language; observatory features (replay, inspectors, usage analytics) are Orrery-specific.

Every event flows through normalize → persist → broadcast → render so live and replay share one code path. The frontend never touches the SDK directly.

> **Credit:** Built on the Cursor SDK. Internal package slugs (`@harness/*`, keychain service `cursor-sdk-agent-harness`, data dir) are unchanged so existing API keys and databases keep working.

## Features

- **Observatory** — consolidated telemetry at `/observatory`: event-log stats, pipeline perf counters, 7-day usage summary, sub-agent monitor.
- **Token-by-token streaming markdown** with hybrid block-boundary re-render (see Phase 09 perf benches in `apps/web/tests/perf/`).
- **Lezer-backed incremental syntax highlighting** for TypeScript, JavaScript, Python, JSON, Markdown, and shell.
- **Live code-edit preview** with caret animation at 120 char/sec default (configurable via replay speed).
- **Tool-call lifecycle cards** with running / completed / error states, args/result JSON inspector, and stall badges.
- **Thinking trace** with collapsible UI and duration.
- **Persistent run history** — every SDK event is canonicalized and stored in SQLite for exact replay.
- **Replay** at instant / 1× / 2× / 4× speeds via the same projection pipeline that drives live runs.
- **Token + cost tracking** with `usage_source` discriminator (`sdk_final_result` / `derived` / `unavailable`).
- **Terminal CLI** — `orrery` (alias: `harness`) with embedded server, interactive TUI, and one-shot `run`.

## Quickstart

### Prerequisites

- macOS (for Keychain integration via `keytar`).
- Node 22+ (Node 26 supported via `better-sqlite3@12.10.0`).
- pnpm 10+.

### Setup

```sh
pnpm install
pnpm migrate          # apply Drizzle migrations to local SQLite
pnpm dev              # server on 127.0.0.1:4783 + web on 127.0.0.1:5173
```

Open `http://127.0.0.1:5173` and pick a workspace. Visit `/observatory` for the consolidated telemetry surface.

### Desktop

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm build:desktop
```

Installs as **Orrery.app** under `apps/desktop/dist-electron/mac-arm64/`.

### CLI

```sh
pnpm -F @harness/cli build
mkdir -p "$HOME/bin" && ln -sfn "$PWD/bin/orrery" "$HOME/bin/orrery"
orrery                # interactive chat (harness alias still works)
orrery run "hello"    # one-shot prompt
```

## First-run setup

### Cursor API key

Set `CURSOR_API_KEY=...` for the first run. Orrery imports it into macOS Keychain (service `cursor-sdk-agent-harness`, account `cursor-api-key`) and ignores the env var on subsequent runs.

### Workspace allowlist

Orrery refuses to create agents against directories not in the allowlist. Add allowed paths via **Settings → Workspaces**.

### Pricing

Token rates are unset by default. The Usage page shows a freshness banner until you enter rates via **Settings → Pricing**.

## Architecture

| Workspace | Owns |
|---|---|
| `apps/server` | Fastify + better-sqlite3 + `@cursor/sdk`. SDK runtime, persistence, WS protocol, security perimeter, usage extraction. |
| `apps/web` | Vite + React 19 + Tailwind v4 + Zustand. AppShell, streaming surfaces, Observatory, replay, history, usage. |
| `packages/shared` | Zod schemas + inferred TS types. WS frame protocol, REST contracts, brand constants. |

Full spec: [`docs/spec-v1.1.md`](docs/spec-v1.1.md). Progress: [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

## Development commands

```sh
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build:desktop
pnpm format
```

## Observability

- Server perf counters exposed via `GET /api/observability/perf` and event-log stats via `GET /api/observability/stats`.
- Observatory page at `/observatory` is the consolidated UI.
- All canonical events persisted to SQLite for forensic replay.

## License

Personal use.
