# Implementation Status

Living index of phase completion against `spec-v1.1.md`. Updated at the end of
each phase. Use it as the single source of truth for "what is decided" vs
"what is still open."

## Phase Index

| Phase | Title | Status | Notes |
|---|---|---|---|
| 01 | SDK Verification & Open Questions | ✅ complete | See `SDK_VERIFICATION_LEDGER.md`. |
| 02 | Monorepo Bootstrap | ✅ complete | pnpm workspace, 3 packages, ESLint flat config + custom rule, Tailwind v4 stub. |
| 03 | Design Token Extraction | ⏳ pending | Next: run `03_DESIGN_TOKENS_FROM_MOCKUP.md`. |
| 1 | Shared Contracts & DB Foundation | ⏳ pending | |
| ≥2 | (per spec §16) | ⏳ pending | |

---

## Phase 01 Outcomes

### Decisions made (binding for downstream phases)

1. **Cancellation primitive**: `Run.cancel()` — sole supported primitive in
   `@cursor/sdk@1.0.13`. `agent.send(prompt, opts)` does NOT accept
   `AbortSignal`. See `SDK_VERIFICATION_LEDGER.md` OQ-11 / OQ-12 / OQ-13.
2. **Run reattach after restart**: `Agent.getRun(runId, options)` IS
   supported. The spec's §11 statement "the current SDK surface does not
   include `Run.get` or stream reattachment" is **superseded** — Phase 14
   should attempt reattach via `Agent.getRun` before marking interrupted.
   See OQ-14.
3. **Usage source**: Token counts (`inputTokens`, `outputTokens`,
   `cacheReadTokens`, `cacheWriteTokens`) ride on
   `SendOptions.onDelta(TurnEndedUpdate.usage)`, NOT on `RunResult` from
   `run.wait()`. Phase 04 normalizer must subscribe to `onDelta`. See OQ-02
   / OQ-03 / OQ-04.
4. **Reasoning tokens**: NOT exposed as a separate count. Stored as `NULL`
   until a Phase 11/14 smoke run confirms billing semantics. See OQ-05.
5. **Approval resolver**: NO public SDK method to resolve `request`
   events in v1.0.13. The harness ships approval in "Partial" form per
   spec §15, surfacing `APPROVAL_UNAVAILABLE` in the UI and never faking
   resolution. Hooks (`.cursor/hooks.json`) are the available out-of-band
   control surface for gating actions BEFORE the SDK is invoked, but are
   not a programmatic substitute. See OQ-10.
6. **Tool name strategy**: Verified literals exist for v1.0.13 (`shell`,
   `write`, `delete`, `glob`, `grep`, `read`, `edit`, `ls`, `readLints`,
   `mcp`, `generateImage`, `recordScreen`, `semSearch`, `createPlan`,
   `task`, `updateTodos`) and subagent kinds (`explore`, `browser_use`,
   `bash`, `shell`, ...). The official docs label tool names as soft
   contract — the harness uses a lookup table for icons/titles with a
   defensive fallback to a generic JSON renderer. See OQ-07.
7. **Code-edit shapes**:
   - `edit.result.value.diffString` is the source of truth for diff preview.
   - `write.args.fileText` carries the new content; `write.result.value
     .linesCreated` and `.fileSize` describe the outcome.
   - `delete.args.path` plus `delete.result.value.fileSize`.
   Truncation flags live on `tool_call.truncated.{args,result}`. See OQ-08.
8. **Streaming markdown package**: `streaming-markdown@~0.2.15`. Phase 09
   must pin with tilde because the package is pre-1.0. See OQ-21.
9. **Lezer parsers** (Phase 10):
   - `@lezer/javascript` (with `dialect: "ts"` and `"jsx"`)
   - `@lezer/python`
   - `@lezer/json`
   - `@lezer/markdown`
   - `@lezer/highlight`
   - `@lezer/common`
   - `@codemirror/legacy-modes/mode/shell` wrapped in
     `StreamLanguage.define` from `@codemirror/language` (no Lezer
     shell grammar exists).
   See OQ-22.
10. **Cloud + MCP option schemas**: `CloudAgentOptions` (OQ-16) and
    `McpServerConfig` (OQ-18) are fully typed and verified. The Phase 06
    UI moves from JSON editor to typed forms.

### Open Questions resolved vs deferred

| # | Question | Status | Deferred-to phase |
|---|---|---|---|
| 1 | Prompt caching SDK metadata/controls | partial | — (downstream design unblocked) |
| 2 | `run.wait()` final result usage shape | verified (no usage) | — |
| 3 | Incremental usage in stream events | verified (`turn-ended`) | — |
| 4 | Cached vs fresh input tokens | verified | — |
| 5 | Reasoning tokens separately reported | unverified | Phase 11 (pricing smoke) |
| 6 | Assistant/thinking delta vs snapshot | partial | Phase 09 (smoke confirms) |
| 7 | Built-in tool names (Explore/Bash/Browser) | partial | Phase 09 (smoke confirms exact `name` field) |
| 8 | Code-edit tool args/results shape | verified | — |
| 9 | `request` event payload beyond `request_id` | verified (sparse) | — |
| 10 | SDK method to resolve approval | unverified — likely unavailable | Phase 12 (re-check on SDK bump) |
| 11 | `agent.send` accepts AbortSignal | verified (no) | — |
| 12 | `Run.cancel()` exists | verified | — |
| 13 | Cancelled run status value | verified | — |
| 14 | Reattach Run after restart | verified | Phase 14 (use it) |
| 15 | `run.wait()` final result shape | verified | — |
| 16 | `CloudOptions` schema | verified | — |
| 17 | `sandboxOptions.enabled` guarantees | verified | — |
| 18 | `McpServerConfig` accepted shapes | verified | — |
| 19 | `Agent.list()` visibility scope | partial | Phase 07 (smoke against real cloud key) |
| 20 | `Agent.get` requires model/options | verified — `Agent.resume` requires model re-pass | — |
| 21 | Streaming markdown package | verified | — |
| 22 | Lezer parser packages | verified | — |

### Spec deltas implied by Phase 01

1. **§11 Mid-run Server Crash Recovery**: The sentence "The current SDK
   surface does not include `Run.get` or stream reattachment. The harness
   does not pretend to resurrect in-flight streams after process death."
   is **outdated**. Phase 14 will reattach via `Agent.getRun(runId,
   options)` BEFORE marking interrupted, then fall back to
   `interrupted_reason = "server_restart"` only if reattach fails.
   Spec amendment to be drafted in Phase 14.
2. **§4 Usage and Cost Extraction Policy**: The "`run.wait()` is the
   authoritative place to extract final usage" sentence must read
   "`onDelta(TurnEndedUpdate.usage)` accumulated over the run is the
   authoritative source" — `run.wait()` returns NO usage field.
   `usage_source` enum value `"sdk_final_result"` is kept as a literal
   but its meaning is the final `turn-ended` event, not the
   `run.wait()` result. Spec amendment to be drafted in Phase 04.
3. **§4 Run Lifecycle step 4–5**: The "Attempt to call
   `agent.send(prompt, { signal: controller.signal })`" branch is
   provably wrong at compile time. Remove the conditional and ship the
   "no signal" path as the only path. Spec amendment to be drafted in
   Phase 04.
4. **§14 Open Questions** (this file's input): mark each row with the
   verdict from `SDK_VERIFICATION_LEDGER.md`. Spec amendment optional —
   the ledger is the durable record.

### Files created in this phase

- `docs/SDK_VERIFICATION_LEDGER.md` — 22-row Open Question ledger.
- `docs/IMPLEMENTATION_STATUS.md` — this file.

### Workspace teardown

- `verification/` (temporary `pnpm` workspace with `@cursor/sdk@1.0.13`)
  will be removed at the end of Phase 01.
- The chosen package versions are pinned in this status doc and the
  ledger; Phase 02 will reinstall them inside the production monorepo.

---

## Phase 02 Outcomes

### Summary

Established the pnpm monorepo and toolchain skeleton. Three workspaces
(`apps/server`, `apps/web`, `packages/shared`) plus a `tooling/`
workspace housing the custom ESLint plugin. Strict TypeScript across the
board (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`). Tailwind v4 wired via `@import "tailwindcss"`.
Fastify health routes and a `useEffect` ban rule are live and tested.

### Decisions made (binding for downstream phases)

1. **Package manager**: pnpm 10.33.x. Workspaces declared in
   `pnpm-workspace.yaml`: `apps/*`, `packages/*`, `tooling/*`.
2. **TS target/lib**: `target: "ES2023"` in the shared base; explicit
   `lib` is set per-package (server: `["ES2023"]`, web:
   `["ES2023","DOM","DOM.Iterable"]`). The base does NOT set `lib`, so
   each child can specialize for Node vs browser cleanly.
3. **Project references avoided at this phase**: Workspace packages
   resolve through `package.json` exports + workspace protocol. We do
   not use `tsc --build` references because they require
   `composite: true` everywhere and a more invasive emit setup. Phase 04
   can revisit if migration speed becomes an issue.
4. **Fastify logger**: Fastify owns its pino instance (`logger: { ... }`
   config form). Redaction paths are passed via Fastify config, not via
   a standalone logger handle. A separate `createLogger` exists in
   `apps/server/src/observability/logger.ts` for non-Fastify call sites.
5. **vitest 3.x**: vitest 2.x only supported vite 5 and conflicted with
   our vite 6 install. Pinned vitest@3.2.4 across all packages.
6. **Tailwind v4.3.0**: 4.0.0 had a known empty-`@import` regression
   that crashed `@tailwindcss/vite`. Pinned 4.3.0 for both `tailwindcss`
   and `@tailwindcss/vite`. `tokens.css` ships with a placeholder
   `:root { --harness-bootstrap-phase: "02"; }` so the v4 generator has
   at least one rule until Phase 03 lands the real `@theme` block.
7. **ESLint custom rule scope**: `harness/no-use-effect-in-components`
   is applied via the flat config's `files:` glob to
   `apps/web/src/{components,pages}/**`. `apps/web/src/hooks/**` and
   anywhere outside the web app are intentionally exempt. Path scoping
   lives in config, not in rule logic, so the rule stays pure and
   reusable.
8. **Vite dev server binding**: `127.0.0.1:5173`. Server bind is
   `127.0.0.1:4783` per spec §9. Both refuse non-loopback hosts unless
   `ALLOW_REMOTE_BIND=true`.

### Files created in this phase

Root + config:
- `package.json` — workspace root, scripts (`dev`, `build`, `typecheck`,
  `lint`, `lint:fix`, `test`, `migrate`, `reset-local-db`, `format`).
- `pnpm-workspace.yaml`.
- `tsconfig.base.json` — strict mode, ES2023, NodeNext, all five
  strictness flags required by the phase prompt.
- `eslint.config.js` — flat config with TS, React (web only), React
  Hooks, and the `harness/no-use-effect-in-components` rule scoped to
  components/pages.
- `prettier.config.js`, `.editorconfig`, `.gitignore`, `.env.example`.

Custom ESLint plugin (`tooling/eslint-plugin-harness/`):
- `package.json`, `tsconfig.json`, `vitest.config.ts`.
- `src/index.js` — plugin entry exposing the rule.
- `src/rules/no-use-effect-in-components.js` — rule logic. Detects
  bare `useEffect(...)` and `<ns>.useEffect(...)` calls.
- `src/rules/no-use-effect-in-components.test.js` — RuleTester unit
  test (valid + invalid fixtures).
- `src/integration.test.js` — `ESLint` API test that lints virtual
  files under `apps/web/src/{components,hooks}` against the real
  `eslint.config.js` and asserts firing vs silent behavior per path.

`packages/shared`:
- `package.json`, `tsconfig.json`, `vitest.config.ts`.
- `src/index.ts` — barrel re-exports.
- `src/json.ts` — `JsonValue` type + `jsonValueSchema` Zod schema +
  `safeStringify` / `safeParse` helpers (mirrors spec §7).
- `src/json.test.ts` — round-trip test for a nested JSON value plus a
  negative case for non-JSON inputs.

`apps/server`:
- `package.json`, `tsconfig.json`, `vitest.config.ts`.
- `src/index.ts` — entrypoint; loads dotenv, env, builds app, listens.
- `src/app.ts` — `buildApp(deps)` Fastify factory with
  `@fastify/cors` and `@fastify/websocket` registered.
- `src/config/env.ts` — Zod env schema (spec §9) with non-loopback
  guard.
- `src/observability/{logger,index}.ts` — pino factory and barrel.
- `src/routes/{health,index}.ts` — `/api/health/{live,ready,version}`.
- `src/{db,sdk,ws,security}/index.ts` — explicit empty placeholders
  to mark the boundaries for Phases 04–07.
- `src/app.test.ts` — `app.inject` smoke test plus non-loopback bind
  rejection assertion.

`apps/web`:
- `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `index.html`.
- `src/main.tsx` — React 19 entrypoint with `BrowserRouter`.
- `src/app/App.tsx` — placeholder route tree rendering
  "Harness — bootstrap OK".
- `src/styles/tailwind.css` — `@import "tailwindcss"` + tokens import.
- `src/styles/tokens.css` — Phase-03 placeholder.
- `src/{components,hooks,pages}/.gitkeep` — empty dirs the ESLint
  rule will guard once components/pages land.

Scripts:
- `scripts/dev.mjs` — colour-prefixed concurrent runner for server + web.
- `scripts/migrate.mjs` — Phase 02 no-op stub.
- `scripts/reset-local-db.mjs` — refuses to run without `--confirm`;
  the destructive path lands in Phase 04.

### Commands run and results

- `pnpm install` — 5 workspace projects resolved, 562 packages.
- `pnpm typecheck` — all four workspaces (`packages/shared`,
  `tooling/eslint-plugin-harness`, `apps/server`, `apps/web`) pass.
- `pnpm lint` — clean, no warnings.
- `pnpm test` — 5 tests across 4 packages (apps/web has 0 with
  `passWithNoTests: true`; apps/server: 2; packages/shared: 2;
  eslint-plugin-harness: 2 across RuleTester + ESLint API).
- `pnpm migrate` — prints "no-op stub" and exits 0.
- `pnpm dev` — Fastify came up on `127.0.0.1:4783`, Vite on
  `127.0.0.1:5173`. Verified by `curl`:
  - `/api/health/live` → `{"status":"ok"}`
  - `/api/health/ready` → `{"status":"ok","checks":{"db":"skipped","keychain":"skipped"}}`
  - `/api/health/version` → `{"status":"ok","version":"0.0.0","phase":"02-monorepo-bootstrap"}`
  - Vite root returned the harness HTML and `tailwind.css` compiled to
    a full v4 utility bundle (200 OK).

### Acceptance gates satisfied

- ✅ `pnpm install` succeeds (only deprecation warning is for a
  transitive `whatwg-encoding@3.1.1` inside jsdom — non-blocking).
- ✅ `pnpm typecheck` passes across all packages.
- ✅ `pnpm lint` passes; the `no-use-effect-in-components` rule fires
  on a virtual fixture under `apps/web/src/components/` and is silent
  under `apps/web/src/hooks/` (proved by the ESLint API integration
  test in `tooling/eslint-plugin-harness/src/integration.test.js`).
- ✅ `pnpm test` runs and passes.
- ✅ `pnpm dev` launches Fastify on 4783 and Vite on 5173. Both
  respond. Health route returns `{"status":"ok"}`. Root URL renders
  the "Harness — bootstrap OK" placeholder.

### Known limitations / deferred items

1. **Project references**: Not configured. Each workspace's
   `tsconfig.json` resolves the other via `node_modules`/`workspace:*`
   rather than TS's `references` machinery. If incremental rebuilds
   become slow this is the lever to pull.
2. **`apps/web` test count is zero**: `passWithNoTests: true` keeps the
   gate green at this phase. Real UI tests land in Phases 06+.
3. **Drizzle / SQLite**: Not installed yet. `better-sqlite3` and
   `drizzle-orm` arrive in Phase 04. `pnpm migrate` is a stub.
4. **Keychain integration**: `keytar` is not installed yet; Phase 05
   wires it alongside CSRF and the workspace allowlist enforcer.
5. **Cursor SDK**: `@cursor/sdk@1.0.13` is intentionally not installed
   in Phase 02. Phase 06 installs it inside the production monorepo,
   relying on Phase 01's verification ledger for surface decisions.
6. **Pino dual-logger**: Fastify owns its logger config; the
   standalone `createLogger` helper in
   `apps/server/src/observability/logger.ts` is currently unused at
   runtime. It is kept because Phase 06+ SDK code paths will emit
   structured logs outside the request lifecycle and re-use it.
7. **Web app type tests skipped**: `vite.config.ts` and
   `vitest.config.ts` are typechecked at install time but use slightly
   different vite type chains internally; runtime is unaffected and
   `pnpm --filter @harness/web typecheck` is green.

## Next prompt to run

`03_DESIGN_TOKENS_FROM_MOCKUP.md`
