# Cursor SDK Agent Harness

A local, single-user, full-stack chat surface around `@cursor/sdk`
(Composer 2.5). Built for personal long-term use with custom
observability, a persistent event log, exact replay, usage accounting,
and a hybrid streaming UI.

The frontend never touches the SDK directly — every event flows
through normalize → persist → broadcast → render so live and replay
share one code path.

## Features

- **Token-by-token streaming markdown** with hybrid block-boundary
  re-render (see Phase 09 perf benches in `apps/web/tests/perf/`).
- **Lezer-backed incremental syntax highlighting** for TypeScript,
  JavaScript, Python, JSON, Markdown, and shell.
- **Live code-edit preview** with caret animation at 120 char/sec
  default (configurable via replay speed).
- **Tool-call lifecycle cards** with running / completed / error
  states, args/result JSON inspector, and Phase 13 "awaiting approval"
  / "still running" / "long-running" badges.
- **Thinking trace** with collapsible UI and duration.
- **Persistent run history** — every SDK event is canonicalized and
  stored in SQLite for exact replay.
- **Replay** at instant / 1× / 2× / 4× speeds via the same projection
  pipeline that drives live runs.
- **Token + cost tracking** with `usage_source` discriminator
  (`sdk_final_result` / `derived` / `unavailable`), pricing settings
  with promo multiplier, and freshness banner when rates are stale.
- **WebSocket reconnect with gap recovery** via `after_seq` replay.
- **Mid-run crash recovery** — runs left in RUNNING state by a prior
  process are finalized with `run.interrupted` + `reason="server_restart"`.
- **API key in macOS Keychain** — one-shot `CURSOR_API_KEY` env import,
  never overwrites an existing entry.
- **Workspace allowlist** with realpath enforcement and symlink-escape
  detection — every cwd is checked before agent creation.
- **MCP server CRUD** with stdio + http probes, redacted-on-list +
  explicit reveal endpoint.
- **Subagent CRUD** with referential integrity and optional model
  override.
- **Approval flow** — inline `ApprovalPrompt` keyed by `request_id`
  with `APPROVAL_UNIMPLEMENTED` banner when the SDK doesn't expose a
  resolver method (current state in `@cursor/sdk@1.0.13`).
- **Honest cancellation** — primary path is `Run.cancel()`, falls
  back to explicit `CANCEL_UNAVAILABLE` when the SDK reports cancel
  is unsupported. Never lies about cancellation state.
- **Comprehensive perf budgets** verified by tests against spec §13
  (SDK event → DB commit p50 <8ms p95 <25ms; streaming markdown
  prose p50 <4ms; block-boundary p50 <12ms; Lezer parse p50 <1ms;
  10k-event stress test).

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

Open `http://127.0.0.1:5173` and you'll see the empty shell. Next: set
up the API key, then add a workspace, then create an agent.

## First-run setup

### Cursor API key

Set `CURSOR_API_KEY=...` for the first run. The app imports it into
macOS Keychain (service `cursor-sdk-agent-harness`, account
`cursor-api-key`) and ignores the env var on subsequent runs. Remove
the env after first import.

```sh
CURSOR_API_KEY=sk-... pnpm dev
```

Alternatively, use **Settings → API Key** in the UI to paste a key
directly. The key is never logged — see the redaction audit at
`apps/server/src/observability/__tests__/redaction-audit.test.ts`.

### Workspace allowlist

The harness refuses to create agents against directories not in the
allowlist. Add allowed paths via **Settings → Workspaces**. Each path
is realpath-resolved; symlinks escaping the allowed root are rejected.

### Pricing

Token rates are unset by default. The Usage page shows a freshness
banner until you enter rates via **Settings → Pricing**.
Per-million-token rates are stored in micro-USD (1 USD = 1,000,000
micros); a promo multiplier in `[0, 1]` lets you apply discounts
(e.g. `0.1` during a 90 %-off promo). Click "Mark verified" to stamp
`last_verified_at`; the UI warns when that timestamp is more than 30
days old.

## Architecture

| Workspace | Owns |
|---|---|
| `apps/server` | Fastify + better-sqlite3 + `@cursor/sdk`. SDK runtime, persistence, WS protocol, security perimeter, workspace policy, usage extraction, MCP/subagent CRUD. |
| `apps/web` | Vite + React 19 + Tailwind v4 + Zustand. AppShell, streaming surfaces, replay, history, usage page. |
| `packages/shared` | Zod schemas + inferred TS types. WS frame protocol, REST contracts, domain types, SDK surface types, pricing/usage types. |

Import direction: `shared` is imported by `server` and `web`; `server`
and `web` never import each other.

Full architectural spec: [`docs/spec-v1.1.md`](docs/spec-v1.1.md).
Design tokens (OKLCH): [`docs/mockup-design-dna.html`](docs/mockup-design-dna.html).
SDK behavior ledger: [`docs/SDK_VERIFICATION_LEDGER.md`](docs/SDK_VERIFICATION_LEDGER.md).
Phase-by-phase progress: [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

## Development commands

```sh
pnpm dev              # start server + web in dev mode
pnpm typecheck        # strict TypeScript across all packages
pnpm lint             # ESLint flat config — includes the no-direct-useEffect rule
pnpm test             # vitest across server + web + shared
pnpm test:perf        # Phase 14 perf benchmarks against spec §13 budgets
pnpm migrate          # apply Drizzle migrations to the local DB
pnpm reset-local-db   # wipe the local SQLite database (destructive)
pnpm build            # production build of every package
pnpm format           # prettier
```

A phase is not considered complete until `pnpm typecheck && pnpm lint
&& pnpm test && pnpm test:perf && pnpm build` all pass.

## Observability

- Server perf counters: `apps/server/src/observability/perf-counters.ts`.
  Exposed via `GET /api/observability/perf` (returns p50/p95/p99 for
  each spec §13 budget metric).
- Client perf counters: `apps/web/src/lib/perf-counters.ts`. Snapshot
  hook on `window.__harnessPerf()` in dev mode.
- Pino logger with comprehensive redaction
  (`apps/server/src/observability/logger.ts`).
- All canonical events persisted to SQLite for forensic replay.

## Known limitations

Honesty-first list — these are the v1.1 partials documented in spec §15.

- **Approval flow (Partial).** `@cursor/sdk@1.0.13` does not expose a
  programmatic method to resolve a `request` approval/denial (OQ-10).
  The harness ships the approval UI with `APPROVAL_UNIMPLEMENTED`
  banner. Re-probed on every SDK bump via
  `apps/server/src/sdk/approval-responder.ts`.
- **Cancellation (Partial).** Primary path is `Run.cancel()`. If
  `Run.supports("cancel")` is false, the harness returns explicit
  `CANCEL_UNAVAILABLE` and leaves the run running rather than faking
  a cancelled state.
- **Cloud mode (Partial).** `CloudOptions` is fully typed (OQ-16
  verified) but the New Agent dialog still uses a JSON editor for the
  cloud sub-config rather than a typed form. Spec §5 calls for a
  typed form; deferred to v1.2 polish.
- **Multi-theme design system (deferred).** Dark mode is the only
  theme; a second reference image hasn't arrived yet.
- **Mid-run stream reattach (deferred).** `Agent.getRun(runId)` is
  verified (OQ-14) but the current Phase 14 startup recovery still
  finalizes every non-terminal run as ERROR with
  `interrupted_reason="server_restart"`. Wiring `getRun` for live
  reattach is a v1.2 task.
- **Reasoning token billing (unverified).** Reasoning tokens are
  persisted when the SDK exposes them but excluded from cost math
  until OQ-05 resolves.
- **EventTimeline virtualization (deferred).** Spec §13 says threshold
  is >200 events; the current implementation handles 10k events in
  ~15ms under jsdom without virtualization. Tighten budget when
  `@tanstack/react-virtual` is wired in for EventTimeline.

See [`docs/SDK_VERIFICATION_LEDGER.md`](docs/SDK_VERIFICATION_LEDGER.md)
for every Open Question status.

## Tagging

This is the v1.1 release.

```sh
git tag v1.1.0
git push --tags
```

## License

Personal use.
