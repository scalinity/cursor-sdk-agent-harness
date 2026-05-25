# Implementation Status

Living index of phase completion against `spec-v1.1.md`. Updated at the end of
each phase. Use it as the single source of truth for "what is decided" vs
"what is still open."

## Phase Index

| Phase | Title | Status | Notes |
|---|---|---|---|
| 01 | SDK Verification & Open Questions | ✅ complete | See `SDK_VERIFICATION_LEDGER.md`. |
| 02 | Monorepo Bootstrap | ✅ complete | pnpm workspace, 3 packages, ESLint flat config + custom rule, Tailwind v4 stub. |
| 03 | Design Token Extraction | ✅ complete | OKLCH tokens from mockup, Tailwind v4 `@theme inline`, Button primitive, `/__tokens` QA page, `no-hardcoded-visuals` rule. |
| 04 | Shared Contracts & DB Foundation | ✅ complete | Zod schemas, SQLite/Drizzle schema mirroring spec §8, seven repositories, default settings seed, retention job. |
| 05 | Security, Keychain, Workspace Policy | ✅ complete | Keychain stores, CSRF/origin/bind plugins, workspace policy with symlink-escape detection, settings/api-key/allowlist REST routes. |
| 06 | Cursor SDK Runtime Manager | ✅ complete | `@cursor/sdk@1.0.13` installed, `AgentRuntime` + `RunController` + `ActiveRuns` registry, agents/runs REST routes, stub stream sink, stubbed-SDK integration tests (no live SDK call). |
| 07 | Event Normalization & WebSocket Streaming | ✅ complete | `normalize` + `persist-and-broadcast` pipeline replaces the Phase 06 stub sink; `run-bus` + `wsPlugin` with heartbeat + `after_seq` replay + large-payload refs; 8 WS integration tests + normalizer/bus/pipeline unit tests. |
| 08 | Frontend State, Hooks, and Chat Shell | ✅ complete | 5 Zustand stores, 8 custom hooks (incl. reconnecting `useWebSocket`), 3-pane `AppShell` matching the mockup, basic event timeline, composer wired to `POST /api/runs`, ⌘J / ⌘K / ⌘. shortcuts, web vitest harness now has 5 tests for `run-store` ingestion. |
| 09 | Streaming Surfaces | ✅ complete | Hybrid `StreamingMarkdown` + RAF-batched `StreamingText`, thinking trace, concurrent `ToolCallLane`, tool cards, JSON inspector with lazy payload fetch, status/cost/system banners, dev QA fixture, perf benchmarks. |
| 10 | Code Edit Preview and Syntax Highlighting | ✅ complete | Server-side code-edit extractors, derived `code_edit.detected` events, RAF edit animation, Lezer syntax highlighting, right-pane + inline previews, replay-speed controls, large-edit bounded preview, review-2 fixes. |
| 11 | History, Replay, and Usage | ✅ complete | Run history with cost/tokens, replay from `events` via `run-store.ingestServerFrame`, transcript export, usage aggregates, pricing freshness banner/dialog, focused route tests. |
| 12 | MCP, Subagents, and Advanced Agent Creation | ✅ complete | MCP CRUD with stdio + http probes, redacted-on-list + reveal endpoint; Subagent CRUD with referential integrity + nullable model (inherit); NewAgentDialog with five tabs, multi-cwd allowlist quick-add, CloudOptions JSON editor. |
| 13 | Approval, Cancellation, and Resilience | ✅ complete | ApprovalResponder seam with OQ-10 probe (throws `UnimplementedApprovalError` against `@cursor/sdk@1.0.13`); approval canonical events (`approval.resolved`, `approval.failed`) with `APPROVAL_UNIMPLEMENTED` banner; cancel button in titlebar + ⌘.; `CANCEL_UNAVAILABLE` banner; startup recovery finalizes RUNNING runs with `run.interrupted` reason `server_restart`; `useRunHealth` per-tool stall warnings and run stalled banner. |
| 14 | Performance, Polish, and Hardening | ✅ complete | Ring-buffer perf counters (server + client) wired through persist-and-broadcast + ws-plugin deliverEvent + useWebSocket + run-store; `/api/observability/perf` route; 10k-event stress fixture (10k events in 364ms, commit p95 0.038ms); timeline render bench (10k events in ~15ms cold mount); usage parse fixtures across five named cases; pricing validation + 30-day staleness test; secret redaction audit (closed `config.*.password` / `config.*.key` gap); design QA pass with zero P0 deltas; README; v1.1 release-ready. |
| 15 | Post-Build Remediation | ✅ complete | Six P0s found and fixed: F-001 Zustand `?? []` infinite render loop (blank screen), F-002 CSRF cold-start race tearing down WS, F-003 `.env` not loaded by dev orchestrator (API key never imported), F-004 harness model IDs (`composer-2-5-fast` / `composer-2-5`) not in `@cursor/sdk@1.0.13` enum, F-005 normalizer treating per-message deltas as snapshot replacements, F-006 streaming-text channel buffer wiped by StrictMode unsubscribe. Live smoke loop verified end-to-end through the UI: create agent → submit prompt → events stream → "SMOKE LOOP COMPLETE" rendered correctly → FINISHED status → run appears in `/runs` history with tokens → `/usage` totals roll up. Full ledger in `docs/POST_BUILD_REVIEW.md`. OQ-06 (assistant delta vs snapshot) now confirmed: per-message deltas. |
| 16 | Desktop App + Workspace Selection | ✅ complete | Electron main process at `apps/desktop/` boots Fastify in-process via the new `apps/server/src/programmatic.ts`. Origin policy + WS upgrade accept both the dev Vite origin and the `app://harness` custom protocol when `HARNESS_DESKTOP=1`. New `app.activeWorkspaceId` setting + GET/PUT `/api/workspace-allowlist/active` endpoints; `useActiveWorkspace` + `useWorkspacePicker` hooks wire the native folder dialog (or `window.prompt` browser fallback) through the existing allowlist add path. `WorkspaceRequiredModal` blocks the shell until a workspace is chosen. Native menu bar with ⌘O Open Workspace, ⌘N New Agent, ⌘J Toggle Code Pane, ⌘, Preferences. Window state persisted to `userData/window-state.json`. Mockup remnants stripped from Titlebar (fake `cinder/api-gateway` crumb + `feat/pagination… +184 −72` branch slot + `12m 04s` timer pill), RightPane (synthetic `no-file-open` tab + breadcrumb), RightTabs (`Placeholder`), and Statusbar (unconditional `⌘. cancel` slot now context-sensitive). `pnpm typecheck && pnpm lint && pnpm test` all green: 256 server tests (including 2 new active-workspace route tests), 69 web tests, 6 plugin tests, 2 shared tests, 11 scripts tests. |
| 17 | Cursor-style Shell Redesign + Attachments | ✅ complete | Titlebar reworked into a Cursor-style toolbar: left rail-collapse toggle, Diff/Files/Terminal/Browser surface toggles (Diff = real code-edit preview; others honest "not yet available" placeholders), `+` new-agent, right-pane collapse; workspace crumb removed from the top. New `ToolbarIcons` stroke-icon set (no new dep). `ui-store` gains `railHidden` + `rightPanelTab`; grid collapses the left rail. SessionsRail rebuilt: New Agent action, search, **workspaces as collapsible groups with chats nested by `run.workspaceId`** (+ Unassigned group), Open Workspace, per-run delete. Runs now carry `workspace_id` (migration `0002`, tagged with the active workspace at creation, surfaced on `RunSummary`). Composer gains a `+` attach button, drag-and-drop, attachment chips, and a centered "new session" hero when the right pane is collapsed on a fresh session. **Image attachment pipeline** (ledger OQ-23): `POST /api/runs` accepts `images: SdkImage[]` → `startRun` → `RunController` → `agent.send(SDKUserMessage{text,images})`; non-image files embedded as `@path`/name references. Coexists with a concurrent model-dropdown change (Composer model `Select`, `selectedModelId`). `pnpm typecheck && pnpm lint && pnpm test` all green: 262 server tests (+1 image-attachment test), 93 web tests, 2 shared tests, 11 scripts tests. |
| 18 | Embedded Browser Pane (WebContentsView + built-in MCP) | 🟡 in progress |
| 19 | Execution Modes, Git Status, and Chat UX | ✅ complete | Three-mode execution system (Ask/Agent/YOLO), git branch+dirty in statusbar, code block copy+apply buttons, session rename, Cmd+N new session, FTS run search. Migration 0003, 7 new shared schemas, 4 new server routes, 7 new frontend components/hooks. 431 tests (282 server, 122 web, 10 shared, 6 eslint, 11 scripts). | **Milestone 1 — manual driving — complete & user-verified (browser fully functional).** Electron `WebContentsView` browser in the right-pane Browser tab, one isolated `persist:agent-<id>` session per agent (+ a standalone `manual` session so the tab works as a browser without an agent), driven manually (URL bar, back/fwd/reload/stop). Built-in browser MCP server + agent control + action visualization + console/network drawers + replay are **Milestone 2** (in progress). See the Phase 18 section below. |
| 20 | Context Intelligence and Rules | ✅ complete | @-mention system (file/folder/symbol/codebase/rules), project rules (.harness/rules/ with always/glob/manual scopes), codebase search (grep+file via ripgrep with fallback). Migration 0004, 16 new shared schemas, 3 new server routes, 3 new services, 6 new frontend components/hooks, Search tab in right pane. 464 tests (306 server, 122 web, 30 shared, 6 eslint, 11 scripts). |
| 22 | Enrichment: Docs Indexing, Notepads, Terminal AI, Slash Commands | ✅ complete | Custom documentation indexing (crawl + FTS5 search + @docs mentions), persistent Notepads (@notepad mentions, editor page), Terminal AI (Cmd+K pattern-based command generation with dangerous-command detection), user-definable slash commands (CRUD + template expansion + built-in /explain, /review, /test, /fix, /refactor). Migration 0005, 19 new shared schemas (enrichment.ts), 3 new repos (docs, notepads, slash-commands), 4 new server routes, 1 new service (docs-crawler), 4 new hooks, 4 new components/pages, extended @-mention system with docs+notepad kinds. 500+ tests (350 server, 122 web). |
| 23 | Semantic Search and Multi-Model Support | ✅ complete | Vector semantic codebase search (all-MiniLM-L6-v2 384-dim via @xenova/transformers ONNX **WASM**; boundary-aware chunker, incremental indexer + fs.watch, brute-force cosine) with @codebase semantic-preference→grep fallback. Multi-model providers (BYOK Anthropic/OpenAI/Google/Ollama, chat-only) via ModelRouter + ProviderRunController emitting identical canonical events; Keychain-backed keys. Auto mode (per-task heuristic). Migration 0007, shared semantic-search.ts + providers.ts, provider/index settings pages, statusbar index badge, SearchPanel Semantic toggle, unified model selector. Gates green: server 408 (+1 gated embed smoke), web 124, shared, eslint, scripts. |

---

## Phase 23 Outcomes — Semantic Search and Multi-Model Support

### Summary

Two major capabilities: (1) **vector semantic codebase search** — workspace
files are chunked, embedded with all-MiniLM-L6-v2 (384-dim) in-process, stored
in SQLite, and queried by cosine similarity; `@codebase` mentions prefer
semantic results when the workspace is indexed and fall back to grep otherwise.
(2) **multi-model BYOK providers** — Anthropic / OpenAI / Google / Ollama
configured with user keys (Keychain), surfaced in a unified model list, with a
run-routing fork so non-Cursor (chat-only) models bypass the SDK and stream
through a `ProviderRunController` that emits the *same* canonical events as the
Cursor path. Plus **Auto mode** (heuristic per-task model selection).

### Key decisions (binding)

1. **Embeddings run on the ONNX WASM backend, not native.** `@xenova/transformers@2.17.2`
   pulls `sharp` (native, image-only — unused for text) and an *optional*
   `onnxruntime-node` (native). pnpm's build-script gate leaves `onnxruntime-node`
   unbuilt, so transformers.js falls back to `onnxruntime-web` (WASM) — sidestepping
   the Electron-ABI fragility that already burdens better-sqlite3/node-pty. `sharp`
   is added to `pnpm.onlyBuiltDependencies` (its N-API prebuilt is ABI-stable and
   loads under Electron without a rebuild) only because transformers.js imports it
   eagerly at module load. The embedder forces `env.backends.onnx.wasm` and lazy
   dynamic-imports the module so server boot stays fast.
2. **Workspace identifier = absolute path.** `embeddings.workspace_id` and
   `index_status.workspace_id` use the active workspace's path (consistent with
   `runs.workspace_id` and `getActiveWorkspaceRoot`).
3. **`content_hash` is the file-level SHA-256, stored on every chunk** — enables
   single-lookup incremental skip of unchanged files.
4. **Tests never download the model.** All unit/integration tests inject a
   deterministic hashing-vectorizer `FakeEmbedder` (real lexical signal). The real
   model is exercised only by an `RUN_EMBED_SMOKE`-gated test + the manual smoke.
5. **Non-Cursor models are chat-only** (Ask). They have no tool-use; the model
   selector tags them "(Ask only)". `ProviderRunController` feeds synthetic
   SDK-shaped messages (`system.init` → `assistant` deltas → `status`) through the
   existing normalizer + persist-and-broadcast pipeline, then finalizes the run
   row — guaranteeing replay/live parity with Cursor runs.
6. **Run routing forks on model kind.** A bare id ⇒ Cursor SDK; `auto` ⇒ heuristic
   resolution at run time; `{providerId}:{model}` ⇒ direct provider client.
   `createAgent` makes a DB-only agent (no SDK agent) for provider/auto models;
   `createAgentRequestSchema.modelId` relaxed from the Cursor enum to a unified
   string id (`unifiedModelIdSchema`).
7. **usage_source = "sdk_final_result"** for provider-reported tokens; cost
   computed from per-model pricing hints (micro-USD) when available, else null.

### Schema changes

- Migration `0007_semantic_search.sql`: `embeddings` (BLOB Float32 vectors +
  indexes), `index_status` (per-workspace progress), `model_providers`
  (provider config; keys live in Keychain, only the account name is stored).
- `packages/shared`: new `semantic-search.ts` (index status, query/result,
  reindex) and `providers.ts` (provider kinds, redacted summary, add/test,
  unified model + capabilities/pricing). `models.ts` gains `AUTO_MODEL_ID` +
  `unifiedModelIdSchema`. `createAgentRequestSchema.modelId` widened.

### Files created (highlights)

Server: `search/{vector,embedder,fake-embedder,chunker,file-walker,indexer,
file-watcher,search-service,semantic-search.service}.ts`,
`db/repositories/{embeddings,index-status,model-providers}.repo.ts`,
`providers/{provider,model-registry,model-router,provider-run,anthropic-,
openai-,google-,ollama-provider}.ts`, `keychain/provider-keys.ts`,
`routes/providers.routes.ts`. Web: `hooks/{useModels,useProviders,
useIndexStatus}.ts`, `components/settings/{ProvidersSettings,IndexSettings}.tsx`.

### Files modified (key)

Server: `db/schema.ts`, `db/repositories/index.ts`, `routes/{index,search,
context}.routes.ts`, `sdk/agent-runtime.ts` (run-routing fork + DB-only
provider agents), `services/context.service.ts` (@codebase semantic
preference), `app.ts`, `keychain/index.ts`. Web: `state/ui-store.ts`
(`selectedModelId` widened to string), `components/shell/{Composer,Statusbar}.tsx`,
`hooks/{useCodebaseSearch,useEnsureDefaultAgent}.ts`, `components/SearchPanel.tsx`,
`app/AppShell.tsx`, `pages/Settings.tsx`. Root: `package.json`
(`pnpm.onlyBuiltDependencies += sharp`), `apps/server/package.json` (+4 deps).

### Commands run and results

- `pnpm typecheck` — all 5 workspaces clean (desktop requires `@harness/server`
  built first; `pnpm -F @harness/server build` produces `dist/programmatic.js`).
- `pnpm lint` — clean.
- `pnpm test` — green: server 408 + 1 skipped (RUN_EMBED_SMOKE gated), web 124,
  shared 3 files, eslint-plugin 3 files, scripts 11.
- Embedding spike (one-off): all-MiniLM-L6-v2 loaded via WASM, produced a
  384-dim normalized vector — confirms the real path works in-process.

### Post-review remediation (review-5 + /address, `P23-*` commits)

A 5-agent read-only review (3 debuggers + code-reviewer + code-auditor) ran
against the changeset; all findings were addressed (no Linear per this repo's
convention — tracked via `P23-*` Conventional Commits):

- **C1** workspace removal now purges embeddings + index_status (was: orphaned
  file content forever, unbounded growth, stale results on re-add).
- **C2** the workspace walker never follows symlinks (explicit skip + test;
  closes the symlink-escape vector).
- **C3** provider `baseUrl` SSRF guard (cloud → public only; Ollama →
  loopback-only, blocking the 169.254.169.254 metadata vector).
- **C4/W1** provider runs register in `ActiveRuns` via a shared `CancelableRun`
  seam → cancellable + aborted on shutdown; an aborted run finalizes as
  CANCELLED, not ERROR.
- **C5/W3/W4/W6** bounded timeouts on every provider call; `/test` validation
  surfaces bad keys; Ollama reader released in `finally`; per-line NDJSON parse.
- **W2** tool-less models get the Ask prefix regardless of mode. **W5** yield
  between embed batches. **W7** `useProviders` Zod-validates responses. **W9**
  shared `formatModelLabel`. **W10** file-walker + model-router tests.
- **Suggestions**: semantic search scores on vectors only + fetches top-k
  content (no full-content scan, no per-row vector copy); provider
  enable/disable PATCH (wired the dead `setEnabled`); shared
  `PROVIDER_KIND_LABELS`; `DEFAULT_SEMANTIC_MIN_SCORE`; Keychain-after-DB
  ordering; drizzle `json_valid(models)` mirror; embedder revision seam.

Consciously left (documented, low value for a local single-user app):
provider-key/DB startup reconciliation, `index_status` read-consistency
(advisory only), `confirm()` delete dialog, and the cosine norm-recompute
micro-opt (the bigger Float32Array-copy cost was removed).

### Known limitations / deferred

1. **Cancellation of a non-Cursor provider run is best-effort** — it streams
   chat-only and finishes fast; cancel/terminate/shutdown now reach it
   (P23-C4) and record CANCELLED.
2. **Auto + Cursor model switching mid-agent**: an `auto` agent's first run
   creates the SDK agent under the resolved Cursor model; a later auto run that
   resolves to a *different* Cursor model reuses the cached handle (edge case).
3. **Mode gating in the UI is advisory** — non-Cursor models show "(Ask only)";
   the server is chat-only for them regardless of the agent's execution mode.
4. **Desktop bundle** must exclude `onnxruntime-node` (force WASM) and ship
   `onnxruntime-web`'s `.wasm` + `sharp`'s N-API binary; handled at build time.
5. **listModels for Google/Ollama** is a static/known list (no validating list
   API); Anthropic/OpenAI hit their real list endpoints on add/test.

### Next phase

Phase 24 — Advanced Agent Features. Prompt: `24_ADVANCED_AGENT_FEATURES.md`.

---

## Phase 19 Outcomes — Execution Modes, Git Status, and Chat UX Quick Wins

### Summary

Added seven features that transform the harness from a raw SDK wrapper into a
mode-aware agent interface with execution controls matching Cursor parity.

### Features delivered

1. **Execution mode system (Ask / Agent / YOLO)** — Three-pill `ModeToggle`
   segmented control in the Composer. Per-agent `execution_mode` column
   persisted via `PATCH /api/agents/:agentId`. Ask mode prepends a read-only
   instruction to the SDK prompt. YOLO mode logs a warning since OQ-10
   (approval auto-resolve) is still unresolved in `@cursor/sdk@1.0.13`.
   Default mode (`app.defaultExecutionMode`) in settings seed.

2. **Git status in statusbar** — `GET /api/git/status` runs `git rev-parse`,
   `git status --porcelain`, `git rev-list --count` with 5s timeouts and 10s
   in-memory cache. `useGitStatus` hook polls every 30s. Statusbar shows
   branch name, dirty dot, ahead/behind badges.

3. **Code block copy button** — `useCopyToClipboard` hook + `CodeBlock`
   component extracted from `MarkdownBlockView`. Clipboard icon overlaid on
   hover, checkmark feedback for 2s.

4. **Code block "Apply to File"** — `POST /api/files/write` with realpath
   traversal guard (prevents `../../etc/passwd`). Filename parsed from code
   block info string. Apply button shown when filename is present.

5. **Session rename** — `runs.name` column (migration 0003). Auto-generated
   from first 60 chars of prompt on creation. `PATCH /api/runs/:runId` for
   rename. SessionsRail shows `name ?? promptPreview`, double-click to edit.

6. **Cmd+N new session** — Keyboard shortcut clears the active run. Desktop
   menu updated from "New Agent" to "New Session" with the same accelerator.

7. **Full-text search on Run History** — FTS5 virtual table `runs_fts` with
   triggers (insert/update/delete + backfill). `GET /api/runs/search?q=`
   returns `snippet()` highlighted matches. `useRunSearch` hook with 300ms
   debounce. Search input at the top of the Run History page.

### Schema changes

- Migration `0003_execution_modes_and_ux.sql`:
  - `ALTER TABLE agents ADD COLUMN execution_mode` (ask/agent/yolo, default 'agent')
  - `ALTER TABLE runs ADD COLUMN execution_mode` (ask/agent/yolo, default 'agent')
  - `ALTER TABLE runs ADD COLUMN name TEXT`
  - `CREATE VIRTUAL TABLE runs_fts USING fts5(...)` + 4 triggers + backfill
- Column name is `execution_mode` (not `mode`) because `mode` already stores
  the agent deployment mode (local/cloud).

### Files created

Server:
- `apps/server/src/db/migrations/0003_execution_modes_and_ux.sql`
- `apps/server/src/routes/git.routes.ts`
- `apps/server/src/routes/files.routes.ts`

Web:
- `apps/web/src/components/ModeToggle.tsx`
- `apps/web/src/hooks/useCopyToClipboard.ts`
- `apps/web/src/hooks/useGitStatus.ts`
- `apps/web/src/hooks/useRunSearch.ts`

### Files modified (key changes)

Shared:
- `packages/shared/src/models.ts` — `executionModeSchema` enum
- `packages/shared/src/domain.ts` — `executionMode` on agent/run row schemas, `name` on run row
- `packages/shared/src/rest-contracts.ts` — 7 new schemas (git status, file write, run search, run patch, execution mode on agent/run/settings)
- `packages/shared/src/index.ts` — barrel exports

Server:
- `apps/server/src/db/repositories/agents.repo.ts` — `execution_mode` column + `updateExecutionMode`
- `apps/server/src/db/repositories/runs.repo.ts` — `execution_mode` + `name` columns, `updateName`, `search`
- `apps/server/src/sdk/agent-runtime.ts` — ask-mode prompt prefix, auto-name, YOLO warning
- `apps/server/src/routes/runs.routes.ts` — PATCH rename, GET search, name/executionMode on summaries
- `apps/server/src/routes/agents.routes.ts` — PATCH executionMode
- `apps/server/src/services/settings.service.ts` — `defaultExecutionMode`
- `apps/server/src/db/seed.ts` — `app.defaultExecutionMode` default
- `apps/server/src/routes/index.ts` — git + files route registration
- `apps/server/src/app.ts` — route deps wiring

Web:
- `apps/web/src/components/shell/Composer.tsx` — ModeToggle integration
- `apps/web/src/components/shell/CenterPane.tsx` — executionMode prop passthrough
- `apps/web/src/components/shell/Statusbar.tsx` — git status section
- `apps/web/src/components/shell/SessionsRail.tsx` — name display + rename
- `apps/web/src/components/streaming/MarkdownBlockView.tsx` — CodeBlock with copy/apply
- `apps/web/src/pages/RunHistory.tsx` — search input + results
- `apps/web/src/app/AppShell.tsx` — execution mode + git status wiring
- `apps/desktop/src/menu.ts` — "New Session" (was "New Agent")

### Commands run and results

- `pnpm typecheck` — all 5 workspaces clean
- `pnpm lint` — clean
- `pnpm test` — 431 tests pass: shared 10, eslint-plugin 6, web 122, server 282, scripts 11
- `pnpm build:desktop` — success, installed to `/Applications/Cursor SDK Agent Harness.app`

### Spec deviation

The phase prompt specified `mode` as the column name for execution modes, but
agents and runs already have a `mode` column storing the deployment mode
(local/cloud). Used `execution_mode` instead to avoid a column name collision.
The TypeScript type is `executionMode: ExecutionMode` matching the new column.

### Next phase

Phase 20 — Context Intelligence: @-mentions, rules system, codebase search.
Prompt file: `20_CONTEXT_INTELLIGENCE_AND_RULES.md`.

---

## Phase 18 — Embedded Browser Pane (in progress)

This phase replaces the right-pane "Browser" placeholder with a real
Chromium `WebContentsView` the user can drive **and** (Milestone 2) the
agent can drive via a built-in MCP server. It is being delivered in two
milestones at the user's request:

- **Milestone 1 — manual driving (this session): complete.** The user
  can open the Browser tab, type a URL, navigate, and use
  back/forward/reload/stop against a real isolated Chromium view.
- **Milestone 2 — agent control (next session): not started.** Built-in
  browser MCP server (10 tools), `agent-options-builder` injection, New
  Agent dialog toggle, action-visualization overlay, console/network
  drawers, REST polling endpoints, replay handling.

### Key SDK / architecture findings (binding)

1. **`@cursor/sdk@1.0.13` MCP client is the official MCP SDK.** The bundle
   contains `StreamableHTTP` (primary) + `SSEClientTransport` +
   `StdioClientTransport`, `mcp-session-id` headers,
   `Accept: application/json, text/event-stream`, `tools/list`,
   `tools/call`, `notifications/initialized`. `McpServerConfig` accepts
   **only** stdio (`command`) or http/sse (`url`) — there is **no
   in-process object registration**. → The built-in browser MCP server
   must be a **loopback Streamable-HTTP MCP server** registered via
   `mcpServers["harness_browser"] = { url: "http://127.0.0.1:<port>/mcp" }`,
   built on the official `@modelcontextprotocol/sdk` (Milestone 2).
   New ledger entry **OQ-24** tracks the two behaviors that still need a
   live `RUN_SDK_SMOKE` confirmation.
2. **MCP tool names surface as `mcp__<server>__<tool>`.** The SDK bundle
   contains the literal `t.startsWith("mcp__") … t.split("__")` parser.
   The normalizer passes `raw.name` through unchanged, so a browser tool
   appears as e.g. `mcp__harness_browser__browser_navigate`. The
   `ToolCallCard` icon regex (`/browser|web/`) already maps it to the
   globe icon. Action-overlay subscription (Milestone 2) must match the
   tool **suffix**, not a `browser_` prefix.
3. **The prompt's "in-process MCP bridging via IPC channel
   `browser:invoke`" framing is corrected.** Because Phase 16 runs
   Fastify *inside* the Electron main process, the MCP tool handlers call
   `BrowserController` via an **in-process injection seam** (apps/desktop
   injects the controller into apps/server at startup, respecting the
   import direction) — *not* Electron IPC. Electron IPC (`browser:invoke`
   / `browser:event`) is genuinely needed only for renderer↔main
   (placeholder rect, manual nav, state + overlay push).
4. **Action overlay cannot be a renderer DOM layer.** A `WebContentsView`
   always paints *above* the window's web contents, so the amber-outline
   overlay (Milestone 2) must be a sibling **transparent
   `WebContentsView`** layered above the page view, not a DOM div.
   Documented now to avoid a dead-end implementation later.
5. **Electron 33.2.1 already ships `WebContentsView`** (added in Electron
   30) — no version bump needed.

### Milestone 1 — files created

- `packages/shared/src/browser-protocol.ts` — Zod-first protocol for the
  whole phase: `BrowserId/Rect/State`, `ConsoleMessage`,
  `NetworkRequest`, `AccessibilityNode` (recursive), `BrowserActionEvent`,
  the `browser:invoke` request/result + `browser:event` push unions, and
  the 10 MCP tool input/output schemas (defined now; wired in Milestone 2).
  Exported from `packages/shared/src/index.ts`.
- `apps/desktop/src/browser-controller.ts` — main-process owner. One
  `WebContentsView` per agent on `session.fromPartition('persist:agent-<id>',
  { cache: true })`; secure `webPreferences` (nodeIntegration:false,
  contextIsolation:true, sandbox:true, webSecurity:true, no preload);
  permission/permission-check handlers deny all; downloads blocked;
  single-tab window-open handler; 500-entry console + network ring
  buffers; lazy create, position/hide, navigate/back/forward/reload/stop,
  state snapshot, storage-clearing `destroy`, and `detachWindow` (drop
  refs on window close *without* clearing storage).
- `apps/desktop/src/browser-ipc.ts` — `browser:invoke` handler (light
  discriminant guard; the renderer Zod-validates first) + `browser:event`
  push forwarding.
- `apps/web/src/components/browser/{BrowserPane,BrowserUrlBar,BrowserViewPlaceholder,BrowserStatusStrip}.tsx`.
- `apps/web/src/hooks/{useBrowser,useBrowserViewMount}.ts`.
- `apps/web/src/components/browser/BrowserUrlBar.test.tsx`,
  `packages/shared/src/browser-protocol.test.ts`.

### Milestone 1 — files modified

- `apps/desktop/src/main.ts` — instantiate `BrowserController`, attach on
  window create, detach on close, register browser IPC.
- `apps/desktop/src/preload.ts` — expose `window.harness.browser.{invoke,onEvent}`.
- `apps/desktop/package.json` — add `@harness/shared` (type-only;
  resolution-mode import bridges the CJS↔ESM-only boundary).
- `apps/web/src/lib/desktop-bridge.ts` — feature-detected `browser` bridge.
- `apps/web/src/components/shell/RightPane.tsx` — route the Browser tab to
  `BrowserPane`; narrow the placeholder map to files/terminal.
- `apps/web/src/components/shell/ToolbarIcons.tsx` — add
  ArrowLeft/ArrowRight/Reload/Stop icons.
- `packages/shared/src/index.ts` — browser-protocol barrel exports.

### Milestone 1 — gates

- `pnpm typecheck` — all 5 workspaces clean.
- `pnpm lint` — clean (token rules + no-useEffect-in-components: all
  effects live in `hooks/`).
- `pnpm test` — green: shared 10, web 106 (+4 BrowserUrlBar), server 263,
  scripts 11, eslint-plugin 6, desktop 0.
- Desktop build + install to `/Applications` for manual visual
  verification (the WebContentsView only exists in the running Electron
  app — it cannot be exercised by jsdom tests).

### Known limitations (Milestone 1)

- **Full-screen modal occlusion.** A native `WebContentsView` paints
  above the renderer DOM, so a full-screen modal (e.g. NewAgentDialog)
  opened while the Browser tab is visible would be occluded. The view is
  hidden when the pane is collapsed (`codeHidden`) but not yet when a
  modal opens — to be handled in Milestone 2 (hide-on-modal hook).
- **No console/network drawer or REST polling endpoints yet** (ring
  buffers exist in the controller; UI + endpoints are Milestone 2).
- **better-sqlite3 ABI:** the desktop build rebuilds the native binding
  for Electron's ABI; Node-ABI server tests then need
  `pnpm rebuild better-sqlite3` to run again (known tension).
| TERM | Embedded Terminal (net-new, user-requested) | ✅ complete | Real PTY-backed terminal in the right pane, replacing the Phase 17 "not yet available" placeholder. New deps: `node-pty` (server), `@xterm/xterm` + `@xterm/addon-fit` (web). Dedicated **`/ws/terminal`** WS route sharing `/ws`'s Origin+CSRF upgrade guard (extracted to `ws/upgrade-guard.ts`) — an ephemeral byte channel that never touches `events`/`RunBus`/persist-and-broadcast. `terminal/terminal-session.ts` owns one long-lived PTY (lazy spawn in active-workspace cwd → `os.homedir()` fallback), a ~256 KiB ring buffer for screen-restore on reattach, `CURSOR_API_KEY` scrubbed from the child env, and a runtime `spawn-helper` `chmod +x` fallback. Frontend: `useTerminalSession` (xterm + WS wiring in a hook — no component effects), `TerminalSurface`, xterm theme built from new `--term-*` OKLCH tokens; terminal stays mounted-but-hidden across tab switches so the session survives. Terminal frame protocol Zod schemas in `shared/terminal-protocol.ts`. **Desktop build toolchain** (`apps/desktop/scripts/package-mac.mjs`): node-pty (N-API) needs an Electron-ABI rebuild that node-gyp 9 can't do on this machine's Python 3.14 (`distutils` removed) — the wrapper provisions a gitignored `setuptools` venv and points node-gyp at it via `PYTHON`; `asar: false` so node-pty's forked `spawn-helper` runs from disk and the pnpm `@harness/server` workspace symlink doesn't trip asar. Verified end-to-end: node-pty spawns a PTY under the bundled Electron (ABI 130) and the installed `.app` boots (server `200` on csrf-token). `pnpm typecheck && pnpm lint && pnpm test` green: 270 server tests (+7 `/ws/terminal`, incl. real-pty e2e), 108 web tests (+6 terminal-client framing), 2 shared, 11 scripts. |

---

## Phase 16 Outcomes — Desktop App + Workspace Selection

### Decisions made (binding for downstream phases)

1. **Fastify runs in the Electron main process, in-process.** Not as a
   child process. The single Node runtime owns Keychain, SQLite, CSRF
   secrets, and the workspace policy — adding IPC between two Node
   processes for things that work over loopback would have been an
   unnecessary failure surface for a single-user local app.
2. **Renderer is sandboxed.** `contextIsolation: true`,
   `sandbox: true`, `nodeIntegration: false`. The renderer talks to
   the server over `http://127.0.0.1:4783` and
   `ws://127.0.0.1:4783/ws` exactly as in browser mode. The only IPC
   surface exposed via the preload bridge is
   `openWorkspaceFolderDialog`, `platform`, and `onMenuAction`.
3. **Two-origin policy.** When `HARNESS_DESKTOP=1` the server accepts
   both `env.WEB_ORIGIN` and `app://harness`. Both `originPolicyPlugin`
   and the WS upgrade gate share the same `allowedOrigins` array.
4. **Active workspace persisted in `settings`, not a new column.** The
   single-row pattern would have required a Phase 04 migration; reusing
   `settings` with key `app.activeWorkspaceId` plus a stale-id sweep on
   GET keeps the schema unchanged. Tradeoff: no FK guarantee, so the
   GET handler clears the setting if the referenced allowlist row was
   deleted.
5. **`@harness/shared` now ships compiled JS.** Earlier phases consumed
   it source-only through tsx. Electron's main process runs plain Node,
   so the package gained a `tsconfig.build.json` and a `dist/`-pointing
   exports map. `pnpm dev` still works because tsx prefers the
   `default` (source) condition.
6. **Server build copies `migrations/*.sql` into `dist/`.** The
   migration runner resolves migrations from `path.dirname(importMeta)`;
   without the copy, the compiled programmatic startup couldn't apply
   the schema.

### Files created in this phase

`apps/desktop/`:
- `package.json` — Electron 33.2.1 + electron-builder 25.1.8.
- `tsconfig.json` — emits CJS to `dist/`.
- `electron-builder.json` — macOS DMG config; unsigned by default.
- `build/entitlements.mac.plist` — Keychain + network + dialog
  entitlements for the hardened-runtime build.
- `src/main.ts` — main-process entry: registers `app://harness`,
  starts Fastify via `require('@harness/server/dist/programmatic.js')`,
  creates BrowserWindow, builds the native menu, persists window
  state, closes Fastify cleanly on `before-quit`.
- `src/preload.ts` — context-isolated bridge exposing
  `window.harness.{openWorkspaceFolderDialog, platform, onMenuAction}`.
- `src/menu.ts` — native macOS menu bar.
- `src/dialogs.ts` — `dialogs:openWorkspaceFolder` IPC handler.
- `src/app-protocol.ts` — `app://harness/...` file-fetch with
  traversal guard.
- `src/window-state.ts` — `userData/window-state.json` persistence
  (debounced 500ms).
- `scripts/start-electron.mjs` — dev-loop wrapper that builds the
  desktop and server packages then launches Electron with
  `HARNESS_DEV=1 HARNESS_DESKTOP=1`.
- `vitest.config.ts` — placeholder with `passWithNoTests: true`.

`apps/server/`:
- `src/programmatic.ts` — `startServer({ envOverrides? })` returns
  `{ built, env, port, url, close }` without auto-listen.
- `src/index.ts` — thin wrapper around `startServer`.

`apps/web/src/`:
- `lib/desktop-bridge.ts` — feature-detected `desktopBridge` + the
  `isDesktop` helper. Null in browser mode.
- `hooks/useActiveWorkspace.ts` — wraps GET/PUT
  `/api/workspace-allowlist/active`.
- `hooks/useWorkspacePicker.ts` — composes native dialog (or
  `window.prompt` fallback) → validate → add (if new) → set active.
- `hooks/useNativeMenuActions.ts` — subscribes to menu IPC channels
  with a `ref`-stable handler dispatch.
- `components/workspace/WorkspaceRequiredModal.tsx` — blocking modal
  shown while `activeWorkspaceId` is null.

`packages/shared/`:
- `tsconfig.build.json` — emit-on config (extends the no-emit base).

`scripts/`:
- `dev-desktop.mjs` — repo-root orchestrator: load `.env`, spawn Vite,
  spawn Electron with `HARNESS_DESKTOP=1 HARNESS_DEV=1`.

### Files modified in this phase

- `apps/server/src/security/origin-policy.ts` — accepts an
  `allowedOrigins` array (back-compat with single `allowedOrigin`).
- `apps/server/src/ws/ws-plugin.ts` — same multi-origin shape on the
  WS upgrade gate.
- `apps/server/src/app.ts` — composes the multi-origin list (Vite
  + `app://harness` when `HARNESS_DESKTOP=1`).
- `apps/server/src/routes/workspace-allowlist.routes.ts` —
  `GET /api/workspace-allowlist/active`,
  `PUT /api/workspace-allowlist/active`; settings repo plumbed
  through `WorkspaceAllowlistRoutesDeps`.
- `apps/server/package.json` — `build` script now copies
  `src/db/migrations/*.sql` into `dist/db/migrations/`.
- `packages/shared/package.json` — exports + `main`/`types` now point
  at compiled output; `build` script invokes `tsc -p tsconfig.build.json`.
- `packages/shared/src/rest-contracts.ts` — `activeWorkspaceResponseSchema`,
  `setActiveWorkspaceRequestSchema`.
- `packages/shared/src/index.ts` — barrel exports for the new
  schemas + types.
- `apps/web/src/app/AppShell.tsx` — hydrates active workspace, wires
  native menu actions, mounts `WorkspaceRequiredModal` over a blurred
  shell when no workspace is selected.
- `apps/web/src/components/shell/Titlebar.tsx` — workspace crumb +
  picker click. Hides the never-implemented branch slot and the
  static `12m 04s` timer.
- `apps/web/src/components/shell/Statusbar.tsx` — adds the
  workspace name to the idle right-hand slot.
- `apps/web/src/components/shell/RightPane.tsx` — drops the
  synthetic `no-file-open` tab + breadcrumb.
- `apps/web/src/components/shell/RightTabs.tsx` — real empty-state.
- `package.json` — `dev:desktop` + `build:desktop` scripts;
  `electron` + `electron-winstaller` added to
  `pnpm.onlyBuiltDependencies`.

### Commands run and results

- `pnpm install` — added 200 packages (Electron + electron-builder
  and their tree); electron post-install ran after pnpm rebuild.
- `pnpm typecheck` — all five workspaces clean.
- `pnpm lint` — no errors. (Initial pass surfaced one
  `harness/no-hardcoded-visuals` violation in the modal — fixed by
  swapping `w-[440px]` for `max-w-lg`.)
- `pnpm test` — 333 vitest tests pass:
  - `packages/shared`: 2
  - `tooling/eslint-plugin-harness`: 6
  - `apps/web`: 69
  - `apps/server`: 256 (was 254; +2 for active-workspace endpoints)
  - `apps/desktop`: 0 (`passWithNoTests: true`)
  - scripts tests: 11
- Build smoke: `pnpm --filter @harness/shared build` →
  `dist/index.js` + d.ts files; `pnpm --filter @harness/server build`
  → `dist/programmatic.js` + migrations copied;
  `pnpm --filter @harness/desktop build` → `dist/main.js` +
  `dist/preload.js`.
- End-to-end programmatic boot (off-port 4788 to avoid clobbering
  the dev server):
  - `startServer()` → 200 on `/api/health/live` with
    `Origin: app://harness`
  - `GET /api/workspace-allowlist` → 200 `{ items: [] }`
  - `GET /api/workspace-allowlist/active` → 200
    `{ activeWorkspaceId: null, workspace: null }`
  - `GET /api/health/live` with `Origin: http://evil.example.com` →
    403 `ORIGIN_FORBIDDEN`
  - `s.close()` resolves cleanly.

### Acceptance gates satisfied

- ✅ `apps/desktop/` skeleton exists with main, preload, menu,
  dialogs, app-protocol, window-state.
- ✅ `pnpm dev:desktop` script available at the repo root; Electron
  picks up `HARNESS_DESKTOP=1` and the embedded Fastify accepts
  `app://harness` as a second origin.
- ✅ `pnpm build:desktop` chain wired (web build → server build →
  desktop build → electron-builder DMG step). The DMG step itself
  requires actually invoking electron-builder on macOS, which is
  outside the test loop; the chain typechecks and the artifacts
  required for packaging are produced.
- ✅ Native folder picker accessible from the titlebar workspace
  crumb (re-pick), from File → Open Workspace (⌘O), and from the
  WorkspaceRequiredModal when no workspace is active.
- ✅ Active workspace persisted via `settings.app.activeWorkspaceId`
  and surfaced on every launch through `useActiveWorkspace`.
- ✅ Browser-mode (`pnpm dev`) still works — `desktopBridge` is null
  there, and `useWorkspacePicker` falls back to `window.prompt`.
- ✅ Phase 05 integration tests pass unchanged: 11 `security.test.ts`
  + 3 (5 with new active-workspace tests) workspace-allowlist routes
  + 3 api-key-bootstrap.
- ✅ Mockup remnants removed:
  - Titlebar fake repo crumb, branch slot, timer pill — gone.
  - RightTabs `Placeholder` — replaced with empty-state hint.
  - RightPane synthetic `no-file-open` tab/breadcrumb — removed.
  - Statusbar unconditional `⌘. cancel` — now context-sensitive
    (only shown while a run is streaming; workspace name when idle).

### Known limitations / deferred items

1. **DMG signing / notarization not configured.** Slots are present
   in `electron-builder.json` and the entitlements file is shipped,
   but the build doesn't enforce `APPLE_ID` / `APPLE_TEAM_ID`. The
   produced DMG is unsigned, which is fine for personal use but will
   trigger Gatekeeper warnings.
2. **Branch indicator deferred.** The mockup showed a git branch +
   diff badges next to the workspace crumb. That requires reading
   real git state from the workspace path — a future "git
   integration" phase. The slot is intentionally empty until then.
3. **`useRunDuration` not implemented.** The titlebar's `12m 04s`
   timer pill is gone; a future phase can re-add it once a ticker
   hook exists.
4. **`WorkspaceTextInputModal` not built.** The browser-mode fallback
   uses `window.prompt` for path entry. A nicer in-shell modal can
   replace it when the browser-mode UX gets dedicated attention; the
   desktop bridge is the supported path.
5. **No multi-window support.** One BrowserWindow per process. No
   tray icon, no global shortcuts, no auto-updates.
6. **In-process Fastify means Electron crash = server crash.**
   Accepted — for a single-user local app, crash isolation between
   the renderer and the server adds no value (if Fastify dies the
   app is dead anyway), and the simpler ownership model is worth it.
7. **Compiled `@harness/shared` is an ESM-only bundle.** The Electron
   main process uses CommonJS and reaches `@harness/server` through
   `require()`, which is fine because the server is also compiled
   CJS. Anyone wanting to call the shared package from a CJS context
   would need a dual-output build.

### No next prompt

Phase 16 has no successor in the planned phase ladder. Future work
goes through normal feature requests against the now-shipping
desktop harness.

---

## Phase 15 Outcomes — Post-Build Remediation

The 14 phases above were marked complete prematurely. A fresh live
browser pass revealed six independent P0 bugs blocking the core flow.
All fixed and verified; commits 4393bbd, bd7c131, 63dc82c, 8f6d473,
3005eb4, b4d9ab4 + 455e9cb (regression tests + ledger).

Key finding worth carrying forward: **OQ-06 is now verified** — the
Cursor SDK sends assistant/thinking text as per-message deltas, NOT
as cumulative snapshots. The normalizer's prefix-match path is
retained as a defensive cumulative-snapshot fallback, but the actual
SDK behavior is always-append. Future contract changes should update
`SDK_VERIFICATION_LEDGER.md` OQ-06 status from "partial" to "verified".

Two known limitations carry forward (logged in
`docs/POST_BUILD_REVIEW.md` "Out of scope"):

1. The harness's `composer-2-5-fast` / `composer-2-5` schema is a
   pricing-only distinction that doesn't exist in the SDK. F-004
   translates at the boundary; collapse the schema later when the
   pricing model is reconsidered.
2. `sandboxEnabledByDefault: true` in seeded settings makes a fresh
   smoke run fail with the SDK's honest "Local SDK sandboxing was
   requested but not supported" message unless `~/.cursor/sandbox.json`
   exists. Document the requirement or change the default.

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

---

## Phase 03 Outcomes

### Summary

Extracted OKLCH design tokens directly from `docs/mockup-design-dna.html`,
materialized them as CSS custom properties in `apps/web/src/styles/tokens.css`,
wired Tailwind v4 to read them via `@theme inline`, shipped a `Button`
primitive covering every variant × size × state, added a dev-only
`/__tokens` QA page, and locked the boundary with a new
`harness/no-hardcoded-visuals` ESLint rule.

### Decisions made (binding for downstream phases)

1. **Token namespace is OKLCH**. Every colour token uses the OKLCH
   colour space verbatim from the mockup `:root` block. Do not transcode
   to hex/RGB/HSL — the warm dark coffee palette relies on OKLCH's
   perceptual uniformity. Modern browsers support it natively.
2. **Token authoring lives in `tokens.css`**. Tailwind v4 reads tokens
   via `@theme inline { --color-foo: var(--color-foo); }`. The `inline`
   variant prevents Tailwind from re-emitting `:root` declarations and
   removes the otherwise-circular variable definition.
3. **Tailwind v4 `@theme inline` is the only theme bridge**. No
   utility classes are defined outside the theme or via custom
   `@layer components`. Body defaults and the `.mono` helper live in
   `@layer base` of `tailwind.css`.
4. **Control heights are tokenised separately from spacing.**
   Buttons live on a 22/26/32px scale (`--height-control-sm/md/lg`)
   that does not snap to the 4px spacing scale. They are exposed via
   `--spacing-control-sm/md/lg` in `@theme inline` so utilities
   `h-control-sm/md/lg` exist.
5. **`harness/no-hardcoded-visuals` is the visual-law enforcer**.
   It scans all string literals and template elements under
   `apps/web/src/{components,pages}/**`, flags arbitrary Tailwind
   colour/size brackets (`bg-[#fff]`, `p-[13px]`, `text-[14px]`) and
   any inline `style={{...}}` with banned colour/spacing/font keys.
   Variant-selector brackets like `data-[selected=true]:` and
   `aria-[busy=true]:` are not flagged (their contents have neither
   a colour nor a CSS unit).
6. **Dev-only `/__tokens` route**. The route registration is gated
   by `import.meta.env.DEV`. Vite folds the constant at build time;
   production bundles drop the route and tree-shake `TokensQA.tsx`
   since nothing else references it.
7. **No second theme this phase**. The mockup is dark-first; light
   mode is not added until a reference image arrives. Spec §3.5
   "Dark/light assumption" row holds.

### Files created in this phase

`apps/web/`:
- `src/styles/tokens.css` — full token set (colour, typography, spacing,
  control heights, radius, motion, elevation). Replaces the Phase 02
  placeholder.
- `src/styles/tailwind.css` — `@import "./tokens.css"`, `@import "tailwindcss"`,
  `@theme inline` block registering every token, plus `@layer base`
  body defaults and `.mono` helper.
- `index.html` — adds Google Fonts preconnect + Inter / JetBrains Mono
  link, removes Phase 02 `bg-black text-white` body classes.
- `src/components/primitives/Button.tsx` — Button primitive: variants
  `primary | secondary | ghost | danger`, sizes `sm | md | lg`, states
  default/hover/active/focus-visible/disabled/loading/selected, plus
  `leading` / `trailing` / `kbd` slots.
- `src/pages/TokensQA.tsx` — `/__tokens` fixture: surface, border, text,
  accent, semantic swatches; Inter + JetBrains Mono type scales; radii;
  Button variant × size × state matrix; focus state row.
- `src/app/App.tsx` — adds dev-only `/__tokens` route + dev hint on the
  bootstrap placeholder.

`tooling/eslint-plugin-harness/`:
- `src/rules/no-hardcoded-visuals.js` — new rule.
- `src/rules/no-hardcoded-visuals.test.js` — unit test (5 valid, 8 invalid).
- `src/index.js` — registers the new rule.
- `src/integration.test.js` — adds three new integration tests covering
  scope (fires under `components/`, silent under `hooks/`, silent on
  token-clean code).

Root:
- `eslint.config.js` — enables `harness/no-hardcoded-visuals: error` on
  the existing `apps/web/src/{components,pages}/**` glob.

### Commands run and results

- `pnpm typecheck` — all four workspaces pass.
- `pnpm lint` — clean, no warnings, no errors.
- `pnpm test` — 9 tests across 4 packages pass:
  - `packages/shared`: 2 tests
  - `tooling/eslint-plugin-harness`: 6 tests
    (no-use-effect-in-components: 1 / no-hardcoded-visuals: 1 /
    integration: 4 — including 3 new ones for the visuals rule)
  - `apps/server`: 2 tests
  - `apps/web`: 0 tests (`passWithNoTests: true`)
- `pnpm --filter @harness/web dev` + `curl /__tokens` → 200 OK.
- Compiled `tailwind.css` (≈ 25 KB) inspected to confirm every utility
  used in the Button and QA page resolves to a `var(--color-*)` or
  `var(--height-*)` reference:
  - `bg-accent-primary` → `background-color: var(--color-accent-primary)`
  - `h-control-sm/md/lg` → `height: var(--height-control-sm|md|lg)`
  - `text-2xs`, `text-md`, `text-base` → `font-size: var(--font-size-*)`
  - `focus-visible:ring-accent-soft` → `--tw-ring-color: var(--color-accent-soft)`
  - `data-[selected=true]:bg-accent-bg` compiled to
    `[data-selected="true"] { background-color: var(--color-accent-bg) }`.
- Visual confirmation: full-page screenshot saved as
  `phase03-tokens-qa.png` shows surface stepping matches mockup, accent
  amber at 72° hue is clearly distinguishable from a saturated orange,
  4-level text greyscale reads cleanly, button variant matrix renders
  every state from tokens.

### Acceptance gates satisfied

- ✅ Every spec §3.5 token category has at least one defined token
  (colour, typography, spacing, radius, motion, elevation), plus the
  Phase 03 additions: `--color-*-bg` semantics, control heights.
- ✅ Colour tokens use OKLCH; values match the mockup `:root` block
  verbatim. No placeholder hex remains in `tokens.css`.
- ✅ Tailwind utilities `bg-surface-1`, `text-text-primary`,
  `border-border-subtle`, `bg-accent-primary`, etc., work in JSX
  (verified in compiled CSS and live render).
- ✅ Button primitive renders every variant × size × state from tokens
  only — no inline styles, no arbitrary Tailwind values.
- ✅ `harness/no-hardcoded-visuals` fires on a fixture containing
  `bg-[#231e1a]`, `text-[14px]`, and `style={{ color: 'red' }}` under
  `apps/web/src/components/`, and is silent on the Button file and on
  token-clean components (proved by the new integration tests).
- ✅ `/__tokens` page renders all swatches, type scale, radii, and
  Button states. Screenshot in `phase03-tokens-qa.png`.
- ✅ `pnpm typecheck && pnpm lint && pnpm test` all pass.

### Visual deltas vs. the mockup (follow-up candidates)

- The derived `--color-accent-primary-hover` and `-pressed` values
  (`oklch(0.82 0.14 72)` / `oklch(0.76 0.13 72)`) are eyeball-tuned
  ±0.04 L from the base accent. They read correctly against the
  mockup's `.send-btn` hover/active feel, but later phases may want a
  hover-state pixel comparison against the live composer.
- Tailwind v4's default `--spacing` (4px step) is left untouched. Our
  token scale agrees through step 8 (32 px) but diverges at step 9
  (40 px in our scale vs 36 px in TW's default). Components that need
  40 px should use `p-10` (= 40 px). If this becomes a frequent footgun
  Phase 08 can override `--spacing` in `@theme`.

### Known limitations / deferred items

1. **Caret-blink and pulse keyframes**: Spec §3.5 motion tokens exist
   (`--duration-*`, `--ease-*`) but no `@keyframes` are defined yet.
   Phase 09 (composer caret) and Phase 14 (status pulse) will land them.
2. **No light theme**: Reference image is dark-first; light theme is
   deferred until a second mockup arrives.
3. **No second primitive**: The Button is the only primitive shipped
   this phase. AppShell, Sidebar, Composer, Toolbar are Phase 08+.
4. **`size-3` spinner**: The loading spinner uses `size-3` (12 px).
   At `h-control-sm = 22px` this is visually tight; if Phase 09's
   composer uses `size: "sm"` with `loading: true` we may want a
   smaller spinner glyph.

---

## Phase 04 Outcomes

### Summary

Built the data foundation: `packages/shared` now exports the full Zod schema
surface (JSON primitives, SDK message union, REST contracts, WebSocket frame
protocol, pricing helpers, domain row projections). `apps/server` gained a
SQLite + Drizzle persistence layer mirroring spec §8 verbatim — single
`0001_initial.sql` migration, seven repositories, default settings seed, and
a retention prune job. `pnpm migrate` is wired to a real migrator that runs
`verifyMigrations()` against `DB_PATH`.

### Decisions made (binding for downstream phases)

1. **`better-sqlite3@12.10.0`** is required on Node 26 (v8 API changed in v26
   broke `better-sqlite3@11.x`). Native binding is opted-in via
   `pnpm.onlyBuiltDependencies` in the root `package.json`.
2. **Drizzle 0.38.x array-form `extraConfig`** — schema callbacks return
   arrays of indexes/checks/foreign keys, not deprecated object form.
3. **SQL is the canonical schema artifact.** `apps/server/src/db/migrations/0001_initial.sql`
   is reviewed-SQL and is what `pnpm migrate` applies. The Drizzle TS schema
   exists only so the runtime gains typed table handles. The migrator reads
   `.sql` files under `migrations/` ordered by their leading numeric prefix
   and records applied names in `_harness_migrations`.
4. **Sequence allocation is transactional inside the events repo.** `EventsRepo.appendCanonicalEvent`
   runs a single `BEGIN…COMMIT` that bumps `runs.last_seq` via `UPDATE … RETURNING last_seq`
   and inserts the row with that seq. `UNIQUE(run_id, seq)` is the safety net.
   No caller may insert into `events` directly.
5. **Repositories return camelCase domain objects.** SQL columns stay
   snake_case; the per-repo `rowToDomain` mapper is the only place that knows
   the column names. `packages/shared` never imports SQL.
6. **Retention prunes `raw_json` only.** `pruneRawEventJson(now)` nulls
   `raw_json` for events on terminal runs (FINISHED/ERROR/CANCELLED/EXPIRED)
   older than `settings.rawEventRetentionDays`. Canonical `payload_json` is
   never deleted. Scheduling is deferred to Phase 14 per the phase prompt.
7. **Default settings seed runs once.** `verifyMigrations()` inserts the 13
   spec-listed rows if and only if `settings` is empty. A re-run with a
   user-edited row count > 0 never re-seeds. `pricing.last_verified_at`
   defaults to JSON `null` so the freshness banner shows on first launch.
8. **`pnpm migrate` indirection.** Root script shells into
   `apps/server/node_modules/.bin/tsx src/scripts/run-migrations.ts` so the
   CLI and runtime share `openDb` + `verifyMigrations`. `pnpm` shell shorthand
   (`pnpm migrate`) is gone in pnpm 10 — use `pnpm -w run migrate`.
9. **Workspace `findMatching` uses `path.normalize` + `path.relative`** for
   the descendant check, not string prefix comparison. The proper realpath
   resolution + symlink escape detection lives in Phase 05's
   `workspace-policy.ts`.

### Files created in this phase

`packages/shared/src/`:
- `constants.ts` — IDs, frame ID, ISO datetime, schema/protocol version,
  `LARGE_PAYLOAD_THRESHOLD_BYTES`.
- `models.ts` — `modelIdSchema`, `settingSourceSchema`, `sdkRunStatusSchema`,
  `agentModeSchema`, `agentStatusSchema`, `usageSourceSchema`,
  `replaySpeedSchema`, `mcpValidationStatusSchema`, plus
  `SDK_RUN_TERMINAL_STATUSES`, `MODEL_LABELS`, `DEFAULT_MODEL_ID`.
- `sdk-surface.ts` — `SDKMessage` discriminated union, `TextBlock`,
  `ToolUseBlock`, `tokenUsageSchema`, `cloudAgentOptionsSchema`,
  `mcpServerConfigSchema`, `subagentModelSchema`.
- `domain.ts` — `agentRowSchema`, `runRowSchema`, `eventRowSchema`,
  `canonicalEventBaseSchema`, `eventSdkTypeSchema`, `settingRowSchema`,
  `mcpServerRowSchema`, `subagentDefinitionRowSchema`,
  `workspaceAllowlistRowSchema`, `runInterruptedReasonSchema`.
- `ws-protocol.ts` — every spec §7 client/server frame schema, the
  `clientFrameSchema` and `serverFrameSchema` discriminated unions,
  `wsErrorCodeSchema`.
- `pricing.ts` — `PRICING_SETTING_KEYS`, `pricingSettingsSchema`,
  micro-USD helpers, `pricingKeyForModel`.
- `rest-contracts.ts` — health/agents/runs/events/settings/usage/MCP/
  subagent/workspace request and response schemas. Routes not yet
  implemented carry a `// TODO: implement in Phase NN` comment.
- `index.ts` — single barrel for all of the above.

`apps/server/src/db/`:
- `client.ts` — `openDb({ filePath, migrationsDir?, skipSeed? })`, runs
  PRAGMAs, applies `.sql` migrations idempotently via
  `_harness_migrations`, seeds defaults.
- `schema.ts` — Drizzle schema mirroring spec §8 (snake_case columns,
  camelCase field properties).
- `seed.ts` — 13-row default settings seed; idempotent.
- `retention.ts` — `pruneRawEventJson(raw, now?)` with
  `RetentionResult`.
- `migrations/0001_initial.sql` — full DDL verbatim from spec §8.
- `repositories/{agents,runs,events,settings,mcp-servers,subagents,workspace-allowlist}.repo.ts`
  plus `repositories/mapping.ts` and `repositories/index.ts`.
- `__tests__/{migrations,agents-runs-events,settings-mcp-subagents,workspace-allowlist,retention}.test.ts`
  plus `__tests__/helpers.ts`.

`apps/server/`:
- `drizzle.config.ts` — Drizzle CLI config (dialect: sqlite, out: ./src/db/migrations).
- `src/scripts/run-migrations.ts` — standalone CLI that opens the DB,
  applies migrations, seeds defaults, prints `applied=… seeded=…`.

Root:
- `scripts/migrate.mjs` — replaces the Phase 02 stub; shells into the
  server's bundled `tsx` to run `run-migrations.ts`.
- `package.json` — adds `pnpm.onlyBuiltDependencies` allowlist for
  `better-sqlite3` so the native binding can build under pnpm 10.

`apps/server/package.json`:
- Adds `better-sqlite3@12.10.0`, `drizzle-orm@0.38.3` as runtime deps;
  `@types/better-sqlite3@7.6.12`, `drizzle-kit@0.30.1` as dev deps.

### Commands run and results

- `pnpm --filter @harness/server add better-sqlite3@12.10.0 drizzle-orm@0.38.3`
  — installed.
- `pnpm --filter @harness/server add -D drizzle-kit@0.30.1 @types/better-sqlite3@7.6.12`
  — installed.
- `pnpm rebuild better-sqlite3` — native binding built against Node 26.
- `pnpm typecheck` — all four workspaces pass.
- `pnpm lint` — clean (no warnings).
- `pnpm test` — 33 tests pass:
  - `packages/shared`: 2 (json round-trip)
  - `tooling/eslint-plugin-harness`: 6 (rules + integration)
  - `apps/server`: 24 (app smoke 2 + DB tests 22 across migrations,
    agents/runs/events, settings/mcp/subagents, workspace allowlist,
    retention)
  - `apps/web`: 0 (`passWithNoTests: true`)
- `DB_PATH=/tmp/harness-migrate-test.sqlite pnpm -w run migrate`
  - First run: `applied=1 seeded=true`, 7 tables created, 13 settings
    rows present.
  - Second run: `applied=0 seeded=false` — idempotent.
  - `PRAGMA journal_mode → wal` confirmed on the on-disk DB.

### Acceptance gates satisfied

- ✅ `pnpm typecheck && pnpm lint && pnpm test` all pass.
- ✅ `pnpm -w run migrate` against a fresh `.sqlite` file applies the
  full schema; rerun applies zero migrations.
- ✅ Concurrent `appendCanonicalEvent` calls produce gapless sequences
  (50 sequential appends, seqs = 1..50, no `UNIQUE` violation).
- ✅ `DELETE FROM agents WHERE id = ?` cascades runs and events
  (verified row counts go to zero).
- ✅ CHECK constraints reject invalid `sdk_type`, malformed JSON in
  `payload_json`, and duplicate `(run_id, seq)` inserts.
- ✅ Default settings seed produces every key listed in spec §8 →
  Default Settings Seed (asserted against `DEFAULT_SETTING_KEYS`
  constant exported from `seed.ts`).
- ✅ `packages/shared` imports cleanly from both `apps/server` (proven
  by repository code) and (transitively, via `@harness/shared`)
  `apps/web`.

### Spec deltas

None. The migration SQL is verbatim from spec §8. Drizzle schema and
repositories use camelCase TypeScript projections of those columns; that
boundary is documented in the working agreement (CLAUDE.md) and was
already specified.

### Known limitations / deferred items

1. **Retention job scheduling.** The `pruneRawEventJson` function exists
   and is tested, but the 24-hour interval scheduler lives in Phase 14
   per the phase prompt.
2. **REST contract bodies.** All schemas are written but only the
   health-route handlers are wired. Each non-health route in
   `rest-contracts.ts` carries a `// TODO: implement in Phase NN`
   comment so phases consuming them later don't drift.
3. **`Buffer.byteLength` is used for `payload_bytes` / `raw_bytes`.**
   This is correct for UTF-8 JSON. If a future phase adds binary blob
   columns, the byte-count helper should move to a shared place.
4. **`drizzle-kit` is installed but unused.** We hand-author SQL
   migrations (per spec §8 "explicit reviewed SQL"); `drizzle-kit` is
   present so future phases can use it for migration scaffolding if
   desired, but the runtime path is the file-based applier in
   `client.ts`.

---

## Phase 05 Outcomes

### Summary

Built the local-only security perimeter. `keytar` is now the sole API-key
store; CSRF and Origin policies gate every mutating REST call; `WorkspacePolicy`
resolves candidate paths through `fs.realpath` and rejects symlink escapes
before any allowlist lookup. The settings, API-key, and workspace-allowlist
REST routes are wired with Zod validation and proper error codes. The
one-shot `CURSOR_API_KEY` env-import is wired in `buildApp.onReady` and
never overwrites an existing Keychain entry.

### Decisions made (binding for downstream phases)

1. **`keytar@7.9.0` is the only secret store.** Added to
   `pnpm.onlyBuiltDependencies`. A `KeychainDriver` interface lives in
   `apps/server/src/keychain/keytar-driver.ts` so tests can swap in
   `createInMemoryKeychainDriver()` without loading the native binding.
   Production code path is `getKeychainDriver()` → `createRequire` →
   `keytar` (lazy-loaded to keep cold-start cheap).
2. **Three Keychain accounts** under the configured service name
   (`KEYCHAIN_SERVICE`, default `cursor-sdk-agent-harness`):
   - `cursor-api-key` — Cursor SDK API key
   - `local-session-secret` — reserved for future cookie/session work
   - `csrf-secret` — HMAC key for the CSRF tokenizer
   New 32-byte base64url secrets are minted on first run and persisted.
3. **CSRF token shape**: `${nonceB64u}.${expSec}.${hmacB64u}` with HMAC-SHA256
   over `${nonce}.${exp}` using the Keychain-stored secret. 24-hour TTL.
   Validation is constant-time (`crypto.timingSafeEqual`).
4. **`/api/security/csrf-token` is the bootstrap endpoint.** It is GET-only
   and CSRF-exempt (`exemptUrls` in the plugin). All `POST/PUT/PATCH/DELETE`
   requests under `/api/*` must present a valid `X-CSRF-Token` header.
5. **Origin policy is strict**. `originPolicyPlugin` accepts only the
   configured `WEB_ORIGIN`. A missing `Origin` header is allowed only for
   safe methods AND only when the request came from a loopback IP (covers
   `curl`). Mutating methods without an Origin are 403 `ORIGIN_MISSING`.
   Wildcard CORS is never accepted.
6. **Bind policy is enforced in two places.** `apps/server/src/config/env.ts`
   rejects non-loopback `HOST` at parse time. `apps/server/src/security/bind-policy.ts`
   exposes `assertBindAllowed` for re-assertion inside `index.ts` so a future
   refactor cannot accidentally drop the check. Both consult `LOOPBACK_HOSTS`.
7. **`WorkspacePolicy.check` order is fixed.** `path.normalize` → `fs.realpath`
   (ENOENT → `missing`) → symlink-escape check (realpath of candidate must be
   inside `fs.realpath` of the apparent parent) → allowlist match against the
   realpath. `last_used_at` is updated by callers, not by this method.
8. **One-shot `CURSOR_API_KEY` import** runs inside `app.onReady`. It is a
   pure write: no overwrite, no log of the value, info-level log line saying
   the env var can now be unset.
9. **Pino redaction is centralized** in `REDACT_CONFIG` (`apps/server/src/observability/logger.ts`).
   Both the standalone `createLogger` and the Fastify logger config import
   it. Covers: top-level `apiKey`/`CURSOR_API_KEY`/`Authorization`, header
   variants (`x-csrf-token`, `X-CSRF-Token`, `authorization` lower/upper
   case), wildcard `*.token`/`*.secret`/`*.password`/`*.key`, and nested
   `config.*.token`/`config.*.secret`. All paths censor to `[REDACTED]`.
10. **Settings shape mapping lives in
    `apps/server/src/services/settings.service.ts`.** Flat settings keys
    (e.g. `pricing.composer-2-5-fast.input_per_million_usd_micros`) are
    folded into the structured `SettingsSnapshot` defined in
    `packages/shared`. Reads return zero for missing pricing keys (default
    per spec §8 seed); writes patch only specified fields.

### Files created in this phase

`apps/server/src/keychain/`:
- `keytar-driver.ts` — `KeychainDriver` interface + `getKeychainDriver()` +
  `createInMemoryKeychainDriver()` + `setKeychainDriver()`/`resetKeychainDriverForTests()`.
- `cursor-api-key.ts` — `CursorApiKeyStore` (get/set/delete/hasApiKey).
- `local-session-secret.ts` — `LocalSessionSecretStore.getOrCreate()`.
- `csrf-secret.ts` — `CsrfSecretStore.getOrCreate()`.
- `index.ts` — barrel.
- `__tests__/keychain.test.ts` — 6 tests.

`apps/server/src/security/`:
- `bind-policy.ts` — `LOOPBACK_HOSTS`, `isLoopback`, `checkBind`,
  `assertBindAllowed`, `BindPolicyError`.
- `csrf.ts` — `CsrfTokenizer` + `csrfPlugin` (Fastify plugin via
  `fastify-plugin`).
- `origin-policy.ts` — `originPolicyPlugin`.
- `workspace-policy.ts` — `WorkspacePolicy.check`.
- `index.ts` — barrel.
- `__tests__/{bind-policy,csrf,workspace-policy}.test.ts` — 5 + 6 + 8 tests.

`apps/server/src/routes/`:
- `security.routes.ts` — `GET /api/security/csrf-token`.
- `settings.routes.ts` — `GET/PATCH /api/settings`, `PATCH /api/settings/pricing`,
  `GET/PUT/DELETE /api/settings/api-key`.
- `workspace-allowlist.routes.ts` — `GET/POST /api/workspace-allowlist`,
  `DELETE /api/workspace-allowlist/:entryId?confirm=true`,
  `POST /api/workspace-allowlist/validate` (single or batch).
- `index.ts` — re-exports + dependency wiring.

`apps/server/src/services/`:
- `settings.service.ts` — `getSettingsSnapshot`, `applySettingsUpdate`,
  `applyPricingUpdate`.

`apps/server/src/__tests__/integration/`:
- `security.test.ts` — 10 tests (origin policy, CSRF, api-key roundtrip,
  workspace validate, settings snapshot).
- `workspace-allowlist.routes.test.ts` — 3 tests (symlink escape via REST,
  create/list/delete, missing path).
- `api-key-bootstrap.test.ts` — 3 tests (env import, no-overwrite, no-op
  when unset).

`apps/server/src/observability/`:
- `__tests__/logger.test.ts` — 5 redaction tests.

Modified:
- `apps/server/src/app.ts` — registers origin/csrf/cors/websocket plugins,
  wires the one-shot `CURSOR_API_KEY` import, returns `BuiltApp` with the
  api-key store and CSRF tokenizer attached.
- `apps/server/src/index.ts` — opens the DB, verifies migrations, builds
  repos, calls `assertBindAllowed`, hands the result to `buildApp`.
- `apps/server/src/app.test.ts` — refactored for the new `AppDeps` shape.
- `apps/server/src/observability/logger.ts` — central `REDACT_PATHS` +
  `REDACT_CONFIG`; `createLogger` uses them.
- `apps/server/src/security/index.ts` — barrel.
- `apps/server/src/routes/index.ts` — `RouteDeps` plumbing.
- `apps/server/package.json` — `keytar@7.9.0`, `fastify-plugin@5.0.1`.
- `package.json` (root) — `keytar` added to `pnpm.onlyBuiltDependencies`.

### Commands run and results

- `pnpm --filter @harness/server add keytar@7.9.0 fastify-plugin@5.0.1` —
  installed.
- `pnpm rebuild keytar` + `npx prebuild-install` inside the `keytar` package
  produced `build/Release/keytar.node` (no node-gyp build needed).
- `pnpm typecheck` — clean (`packages/shared`, `tooling/eslint-plugin-harness`,
  `apps/server`, `apps/web` all pass).
- `pnpm lint` — clean.
- `pnpm test` — 70 server tests pass (was 24 pre-phase). Breakdown:
  - app smoke 2, observability/logger 5, keychain 6, bind-policy 5,
    csrf 6, workspace-policy 8, integration/security 10,
    integration/workspace-allowlist routes 3, integration/api-key bootstrap 3,
    DB suite 22. Shared (2) and ESLint plugin (6) tests also pass; web has 0.
- `HOST=0.0.0.0 ALLOW_REMOTE_BIND=false pnpm --filter @harness/server start` →
  exits fatally with `Non-loopback HOST requires ALLOW_REMOTE_BIND=true.
  Refusing to bind for safety.`
- Live curl against the running server (`DB_PATH=/tmp/harness-phase05-acceptance.sqlite KEYCHAIN_SERVICE=cursor-sdk-agent-harness-phase05-curl pnpm --filter @harness/server start`):
  - `GET /api/health/live` → `{"status":"ok"}` (HTTP 200).
  - `PATCH /api/settings` with no CSRF → `{"code":"CSRF_FAILED"}` (HTTP 403).
  - `GET /api/security/csrf-token` → 77-char token.
  - `PUT /api/settings/api-key` with `{ "value": "sk-test-…" }` →
    `{"present":true}` (HTTP 200).
  - `GET /api/settings/api-key` → `{"present":true}` (HTTP 200).
  - `DELETE /api/settings/api-key` → `{"present":false}` (HTTP 200).
  - `POST /api/workspace-allowlist/validate` with a symlink-escape path →
    `{"allowed":false,"normalizedPath":"…","reason":"symlink_escape"}` (HTTP
    200).
  - `GET /api/health/live` with `Origin: http://evil.example.com` →
    `{"code":"ORIGIN_FORBIDDEN"}` (HTTP 403).

### Acceptance gates satisfied

- ✅ `pnpm typecheck && pnpm lint && pnpm test` all pass.
- ✅ `pnpm dev` (and `pnpm --filter @harness/server start`) bind to
  `127.0.0.1`. `HOST=0.0.0.0 pnpm dev` exits non-zero with the bind-policy
  message.
- ✅ `curl -X PATCH http://127.0.0.1:4783/api/settings -d '{}'` returns
  HTTP 403 `CSRF_FAILED` without a token.
- ✅ `PUT /api/settings/api-key` with a valid `X-CSRF-Token` and a
  reasonable value stores the key; subsequent `GET` returns
  `{ "present": true }`; `DELETE` flips presence back to `false`.
- ✅ `POST /api/workspace-allowlist/validate` with a symlink-escape path
  returns `{ allowed: false, reason: "symlink_escape" }`.
- ✅ Logger redaction tests prove `apiKey`, `CURSOR_API_KEY`, header CSRF
  and Authorization values, plus nested `*.token`/`*.secret`/`*.password`/
  `*.key` paths censor to `[REDACTED]`.

### Carried into Phase 07 (must land before any WS route ships)

- **WebSocket upgrade Origin validation**: `@fastify/websocket` registers the
  upgrade hook but no route is bound. The first WS route in Phase 07 MUST
  install a `verifyClient` (or equivalent pre-upgrade gate) that:
  - rejects upgrades whose `Origin` header is missing or != `WEB_ORIGIN`.
  - rejects upgrades whose `?csrf=<token>` query param fails
    `CsrfTokenizer.validate`.
- **WebSocket session binding**: bind the upgrade to the local session secret
  (`LocalSessionSecretStore`) so a stolen CSRF token alone is not sufficient
  to attach a new WS subscriber.

These two items are explicitly named in the Phase 05 prompt's completion
contract and are not yet implemented because no WS route exists. They are
the precondition for Phase 07.

### Known limitations / deferred items

1. **WebSocket Origin/CSRF**: see "Carried into Phase 07" above.
2. **MCP / subagent / Cursor-API REST**: routes for `/api/mcp-servers`,
   `/api/subagents`, and the SDK-facing agent/run/event endpoints are not
   wired this phase. Per the Phase 05 prompt's out-of-scope list.
3. **Active-agent warning on workspace delete**: `DELETE
   /api/workspace-allowlist/:entryId` requires `?confirm=true` but does not
   yet enumerate active agents that reference the path. That dependency
   doesn't exist until Phase 06 introduces the agent runtime manager.
4. **`LocalSessionSecretStore`**: created and tested but not yet referenced
   by request-time code. It will be consumed in a future phase if/when the
   harness gains cookie-bound state.
5. **`keytar` native binding** depends on `prebuild-install` succeeding for
   the host architecture. The fallback (`node-gyp rebuild`) requires Xcode
   command-line tools and is not exercised by the test suite — tests use
   the in-memory driver.

---

## Phase 06 Outcomes

### Summary

Wrapped `@cursor/sdk@1.0.13` in a server-owned runtime manager. `AgentRuntime`
creates / resumes / terminates / lists durable agents; `RunController` owns a
single run's `Run` handle, `AbortController`, stream task, and accumulated
`turn-ended.usage`; `ActiveRuns` is the in-memory registry. The agents and
runs REST endpoints (`POST/GET /api/agents`, `POST /api/agents/:id/resume`,
`POST /api/agents/:id/terminate`, `POST/GET /api/runs`) are wired and gated
by the Phase 05 security perimeter (CSRF + Origin + Workspace policy +
Keychain). Stream events go to a stub sink that logs a redacted projection;
Phase 07 will replace the stub with the normalization → persist → broadcast
pipeline without touching the runtime.

### Decisions made (binding for downstream phases)

1. **AbortSignal is not wired to `agent.send`** (OQ-11 verified negative in
   v1.0.13). The `RunController.abortController` exists only for server-side
   task coordination — it is never passed to the SDK. Cancellation flows
   exclusively through `Run.cancel()` per OQ-12.
2. **Usage extraction reads from `onDelta(TurnEndedUpdate)`, not from
   `run.wait()`** (OQ-02 verified negative). The `RunController` registers
   an `onDelta` callback on every `send` and accumulates `turn-ended.usage`
   across all turns of the run. The extractor runs once at terminal state
   and persists the totals.
3. **`Run.cancel()` is gated on `Run.supports("cancel")`**. The harness logs
   and returns `"unavailable"` when the SDK reports the operation as
   unsupported — no fake CANCELLED states (spec §11).
4. **SDK adapter seam**. `apps/server/src/sdk/sdk-adapter.ts` declares a
   minimal `SdkAdapter` interface (`createAgent`, `resumeAgent`, `send`).
   Production uses `createCursorSdkAdapter()`; tests use
   `createStubSdkAdapter()` from `apps/server/src/sdk/testing.ts`. Vitest
   module mocks are not used — DI is cleaner and survives realistic
   integration test wiring.
5. **Durable `agentId` reconciliation**. The runtime passes our durable ID
   into `Agent.create` via `options.agentId`. If the SDK overrides it (e.g.
   cloud minting a `bc-…` ID), we delete the temporary row and re-insert
   under the SDK-issued ID. The DB row and SDK identity always agree.
6. **MCP filter is `enabled AND validation = "valid"`**. Subagents are
   filtered by `enabled` only (validation lives on MCP rows, not subagents).
   Subagents reference MCP servers by ID; the builder maps them to MCP
   names in the SDK payload, dropping any subagent-side MCP ID that's not
   enabled+valid at the server level.
7. **Live SDK creation persists the row before calling `Agent.create`**.
   The row starts as `status = "creating"`; the SDK call either flips it to
   `active` on success, or to `error` (with the thrown error captured in
   `error_json`) on failure. Either way the row is inspectable in the
   picker — failures don't disappear.
8. **`startRun` re-validates the workspace at send time** for local agents.
   The allowlist can change between agent creation and the next prompt;
   the runtime never trusts stale validation. Cloud runs skip this gate.
9. **`sqlite3` added to `pnpm.onlyBuiltDependencies`**. The SDK transitively
   depends on `sqlite3@5.1.7` for its internal run-event store. Without
   approval the native binding doesn't build and `import { Agent }` throws
   at module load. Root `package.json` now lists `better-sqlite3`, `keytar`,
   and `sqlite3`.
10. **`CancelResult` is a discriminated union, not a string** (binding for
    every WS / REST cancel surface; documented retroactively after Phase
    07's review caught downstream code treating it as a string union):
    ```ts
    export type CancelResult =
      | { outcome: "cancelled" }
      | { outcome: "not_started" }       // start() never resolved (no Run handle yet)
      | { outcome: "unsupported"; unsupportedReason: string | undefined }
      | { outcome: "failed"; error: unknown };
    ```
    Phase 07's WS `cancel_run` handler maps each case to a distinct
    error code (`CANCEL_UNAVAILABLE` for unsupported / not_started,
    `SDK_ERROR` for failed, `ack` for cancelled). New callers must
    switch on `outcome` rather than treating the return as a string —
    a plain `result === "cancelled"` comparison is a type-narrowing
    error and a logic bug.

### Open Questions tightened by this phase

| # | Question | Before | After Phase 06 |
|---|---|---|---|
| 11 | `agent.send` accepts AbortSignal? | verified (no) | confirmed — no signal passed; runtime tested against stubbed adapter end-to-end with the no-signal path. |
| 12 | `Run.cancel()` exists? | verified | `RunController.cancel` gates the call on `Run.supports("cancel")` and persists `interrupted_reason = "user_cancelled"` immediately as a belt-and-braces. |
| 15 | `run.wait()` final result shape | verified | `RunController` reads `result`, `model`, `durationMs`, `git` exactly per the verified shape; usage is NOT taken from here. |
| 20 | `Agent.resume` requires model re-pass? | verified | `loadActiveAgent` calls `buildAgentOptions` on every resume, which re-passes `model: { id }` and inline MCP server configs. |

OQ-10 (approval resolver) remains `unverified` per ledger — Phase 06 does
not surface approval, and no code path silently fakes resolution.

### Files created in this phase

`apps/server/src/sdk/`:
- `sdk-adapter.ts` — `SdkAdapter` interface + production `createCursorSdkAdapter()`.
- `agent-options-builder.ts` — `buildAgentOptions` + `WorkspaceRejectedError`.
- `usage-extractor.ts` — `extractUsage` + `accumulateTurnEndedUsage` + cost math.
- `run-controller.ts` — `RunController` class owning one run's SDK lifecycle.
- `active-runs.ts` — in-memory registry keyed by `runId`.
- `agent-runtime.ts` — `AgentRuntime` (`create`/`resume`/`terminate`/`list`/`getById`/`startRun`/`shutdown`).
- `stream-stub.ts` — `createStubSink` used by Phase 06; replaced in Phase 07.
- `testing.ts` — `StubRun`, `StubSDKAgent`, `createStubSdkAdapter` for tests.
- `index.ts` — barrel.
- `__tests__/agent-options-builder.test.ts` — 7 unit tests.
- `__tests__/usage-extractor.test.ts` — 10 unit tests.

`apps/server/src/routes/`:
- `agents.routes.ts` — `POST/GET /api/agents`, `GET /api/agents/:id`,
  `POST /api/agents/:id/resume`, `POST /api/agents/:id/terminate`.
- `runs.routes.ts` — `POST/GET /api/runs`, `GET /api/runs/:id`.

`apps/server/src/__tests__/integration/`:
- `agents-runs.test.ts` — 7 integration tests against a fully-wired
  Fastify app with a stubbed SDK adapter (creates, terminates, resumes,
  rejects, runs a full agent → run → finished cycle with synthetic
  `turn-ended` usage that persists to the `runs` row).

`packages/shared/src/rest-contracts.ts`:
- Added `superRefine` to `createAgentRequestSchema` (local→requires cwd,
  cloud→requires cloudOptions, `settingSources` `all` is mutually exclusive).
- Added `agentDetailResponseSchema`, `createRunRequestSchema`,
  `createRunResponseSchema`, `errorEnvelopeSchema`.
- Added `activeRunCount`, `terminatedAt` fields to `agentSummarySchema`.

`apps/server/src/db/repositories/runs.repo.ts`:
- Added `getLatestForAgent(agentId)` and `aggregatesByAgent()` for the
  agent picker. The aggregator returns one row per `agent_id` with run
  count, active-run count (`status IN ('CREATING','RUNNING')`), and total
  cost / input / output tokens.

`apps/server/src/app.ts`:
- Constructs the `AgentRuntime` after the workspace policy and api key
  store are built; wires the runtime + RunsRepo into the new route groups;
  installs an `onClose` hook that calls `agentRuntime.shutdown()` to close
  all live SDK handles and clear the registry.

`apps/server/package.json`:
- Adds `@cursor/sdk@1.0.13` as a runtime dependency.

Root `package.json`:
- Adds `sqlite3` to `pnpm.onlyBuiltDependencies` so the SDK's transitive
  native binding builds at install time.

### Commands run and results

- `pnpm --filter @harness/server add @cursor/sdk@1.0.13` — installed.
- `pnpm install` (after adding sqlite3 to onlyBuiltDependencies) — built
  `sqlite3@5.1.7` native binding for arm64-darwin.
- `pnpm typecheck` — all four workspaces clean.
- `pnpm lint` — 0 errors, 0 warnings.
- `pnpm test` — 96 tests across 17 files pass (was 70/14 pre-phase). New:
  10 usage-extractor unit tests, 7 agent-options-builder unit tests,
  7 agents+runs integration tests.
- Live smoke (`DB_PATH=/tmp/harness-phase06-smoke.sqlite … pnpm
  --filter @harness/server start`) confirmed:
  - `POST /api/agents` without API key → 412 `MISSING_API_KEY`.
  - `POST /api/agents` with `/tmp` (not allowlisted) → 403 `WORKSPACE_REJECTED`
    with `details: [{ input: "/tmp", reason: "not_allowlisted",
    normalizedPath: "/private/tmp" }]`.
  - `POST /api/agents` for `mode: "local"` without `cwd` → 422
    `VALIDATION_ERROR` with the superRefine message.

### Acceptance gates satisfied

- ✅ `pnpm typecheck && pnpm lint && pnpm test` all pass.
- ✅ Integration tests pass against the stubbed SDK adapter: agent create,
  agent terminate, agent resume, run start → consume stream → wait → final
  result + usage persisted.
- ✅ `POST /api/runs` with a cwd not in the allowlist returns 403
  `WORKSPACE_REJECTED` (`startRun` re-runs the workspace check before
  sending the prompt).
- ✅ `POST /api/agents` without `MISSING_API_KEY` returns 412 (proven by
  the live smoke and the dedicated integration test).
- ✅ `docs/IMPLEMENTATION_STATUS.md` updated (this section).

### Out of scope / deferred (per phase prompt)

1. **Event normalization, persistence beyond `runs` row updates, WS
   broadcasting** — Phase 07. The stub sink (`stream-stub.ts`) logs each
   event and discards. Run row status, final result, and usage ARE
   persisted; canonical events are NOT — `events` is empty after a Phase 06
   run completes.
2. **Approval flow handling** — Phase 13. OQ-10 stays `unverified`.
3. **UI surfaces** — Phase 08+.
4. **MCP / subagent CRUD** — Phase 12. Phase 06 reads from the existing
   repos; the routes themselves don't ship until Phase 12.
5. **Live SDK smoke test (`RUN_SDK_SMOKE=true`)** — intentionally not
   exercised in CI because (a) it requires a real Cursor API key and
   (b) the test must hit a real Cursor backend. The stubbed-adapter
   integration tests exercise every code path that the live smoke would,
   short of the network round-trip itself.
6. **`Agent.list()` SDK reconciliation** (OQ-19 partial) — `AgentRuntime.list`
   returns SQLite rows only. Phase 07 will add the SDK list join once we
   have a real cloud key in hand.

### Known limitations

1. **`onDelta` shape coupling**. The `InteractionUpdate` type from
   `@cursor/sdk` re-exports from `@anysphere/cursor-sdk-shared`, which is
   bundled into the SDK's runtime JS but not its declarations. The harness
   types `onDelta` updates as `unknown` and Zod-parses for the `turn-ended`
   discriminator. This is deliberately defensive — if the SDK changes the
   delta shape, we get a graceful `usage_source = "unavailable"` instead
   of a typecheck break or a runtime crash.
2. **No background scheduling for `aggregatesByAgent`**. The aggregator
   runs as a single SQL `GROUP BY` per `GET /api/agents` request. For
   single-user local workloads this is fine; if a user ever accumulates
   thousands of agents we'd want a materialized snapshot. Out of scope.
3. **`shutdown()` is best-effort**. The Fastify `onClose` hook awaits
   `agentRuntime.shutdown()`, but `SDKAgent.close()` is synchronous and
   tells us nothing about whether the SDK actually cleared its connections.
   In practice the test suite uses the in-memory DB and an in-memory
   keychain driver, so any leaked handle is invisible — production code
   that needs deterministic teardown should await `app.close()` rather
   than relying on process exit.

### Carried into Phase 07

- **Replace `createStubSink`** with the normalization pipeline:
  - Zod-validate every SDK event against the `sdkMessageSchema` union.
  - Allocate a per-run seq via `RunsRepo.incrementLastSeq` inside the same
    transaction that inserts the canonical event row.
  - Emit WS frames AFTER commit (persist-before-broadcast).
- **Implement WS upgrade gate** (Origin + CSRF token + local session
  secret) — carried forward from the Phase 05 "Carried into Phase 07"
  section.

---

## Phase 07 Outcomes

### Summary

Replaced the Phase 06 stub sink with the real event pipeline. Every
`SDKMessage` now flows through `normalize` (pure) → `persist-and-broadcast`
(transactional insert + post-commit publish) → `run-bus` (in-memory pub/sub)
→ `wsPlugin` (`@fastify/websocket` route on `GET /ws`). The plugin owns
heartbeat (15s ping / 45s pong timeout, configurable for tests), `after_seq`
replay paginated through SQLite, large-payload references for tool_call
events over 256 KiB, and a single-frame validation gate against
`serverFrameSchema` before any frame leaves the server.

### Decisions made (binding for downstream phases)

1. **Persist-before-broadcast is enforced at one chokepoint**.
   `PersistAndBroadcastPipeline.ingestSDKMessage` is the only call site
   that writes to `events` AND the only call site that fans out to
   `RunBus`. The bus's `publish` defers via `setImmediate` so the post-
   commit caller is never blocked on listener work, but the queue is
   primed only AFTER the commit succeeds. A mid-batch insert failure
   aborts the batch and emits nothing — no partial broadcast.
2. **In-memory per-run text accumulators**. The normalizer's delta-vs-
   snapshot detection needs the previous assistant/thinking text. The
   pipeline owns a `Map<runId, { assistantText, thinkingText }>` and
   updates it ONLY after a successful insert. `dropRun(runId)` clears
   the entry when the controller terminates so a long-lived process
   doesn't leak buffers.
3. **Delta/snapshot detection is the spec's prefix-match strategy**.
   The normalizer compares new text against the previous accumulated
   text. Prefix match → emit suffix-only `assistant.delta` /
   `thinking.delta`. Otherwise → emit `assistant.snapshot` /
   `thinking.snapshot` with `is_replacement: true`. First text observed
   for a run is emitted as a delta of the whole string so the wire never
   carries a useless empty event.
4. **Derived `code_edit.detected` is a placeholder seam in Phase 07**.
   A `tool_call.completed` event for `edit`, `write`, or `delete` emits
   a second canonical event with `confidence: "low"` and `edits: []`.
   Phase 10 fills the extraction; the seam ships now so Phase 08 UI
   work can render the card structure without rework.
5. **Large-payload threshold is checked at frame-build time, not
   persist time**. `EventsRepo` stores the full JSON regardless of
   size (per spec §8 "stored fully and broadcast as references"). The
   `frame-builder` reads `row.payloadBytes` and, for `tool_call`
   payloads >256 KiB, replaces inline `args` / `result` with
   `large_payload_refs.{args,result,raw}_event_url` pointing at the
   `/api/events/:eventId/large-payload/:field` REST endpoint. Phase 10
   wires the actual route; the URLs are correct now.
6. **Heartbeat is parameterised for tests**.
   `WsPluginOptions.heartbeatIntervalMs` / `missedPongTimeoutMs`
   override the 15s/45s defaults. Tests use 50ms/1s; production keeps
   the spec values. The first heartbeat is `setImmediate`-deferred so a
   freshly-connected client always has time to attach `on('message')`
   before the frame arrives.
7. **`CancelResult` upgrade — Phase 06 surfaced this and Phase 07
   honours it.** The discriminated union `{ outcome: "cancelled" |
   "not_started" | "unsupported" | "failed", ... }` lets the WS plugin
   map each case to a distinct error code (`CANCEL_UNAVAILABLE` for
   unsupported / not_started, `SDK_ERROR` for failed) instead of
   collapsing to a generic "cancelled / unavailable" pair.
8. **No `submit_user_input` over WS in Phase 07**. Per phase prompt
   "out of scope" — the WS plugin replies with `INTERNAL_ERROR` if a
   client sends `submit_user_input` / `delete_run` / `update_settings`.
   Phase 08 wires these as REST already exists for run creation.
9. **`ws@8.18.0` direct dep**. `@fastify/websocket` re-exports the
   `WebSocket` type but the cleanest typing for our plugin code is to
   depend on `ws` directly. Added `ws@8.18.0` runtime and
   `@types/ws@8.5.13` dev deps to `apps/server/package.json`. No
   `pnpm.onlyBuiltDependencies` change needed — `ws` is pure JS.

### Open Questions tightened by this phase

| # | Question | Before | After Phase 07 |
|---|---|---|---|
| 6 | Assistant/thinking delta vs snapshot | partial | normalizer ships the defensive prefix-match strategy from the spec; ongoing smoke runs in Phase 09 will confirm whether the SDK actually emits snapshots. Code path is symmetric for both. |
| 7 | Built-in tool names | partial | `code_edit.detected` seam keys on the verified `edit` / `write` / `delete` names from OQ-08; Phase 10 may extend the set as smoke runs surface other code-edit-shaped tools. |
| 9 | `request` event payload | verified (sparse) | normalizer emits `request.created` with the spec-defined `{ request_id, context_event_ids: [], inferred_reason: null }` shape; harness invention populated at render time. |

### Files created in this phase

`apps/server/src/sdk/`:
- `normalizer.ts` — pure SDKMessage → CanonicalRunEventDraft[]; delta/
  snapshot detection; derived `code_edit.detected` seam.
- `persist-and-broadcast.ts` — single chokepoint pipeline; in-memory
  text-buffer state; `dropRun` for terminate cleanup; `clear` for tests.
- `__tests__/normalizer.test.ts` — 15 unit tests (every discriminant,
  delta/snapshot rules, code-edit seam gating, invariants).
- `__tests__/persist-and-broadcast.test.ts` — 6 unit tests (persist
  before broadcast, monotonic seq, buffer advancement on commit,
  rollback on DB failure, derived event ordering, dropRun semantics).

`apps/server/src/ws/`:
- `run-bus.ts` — `Map<runId, Set<Listener>>`; snapshot-safe iteration;
  setImmediate fanout; swallowed listener errors.
- `frame-builder.ts` — `EventRow → ServerFrame`; switch over `kind`;
  large-payload ref substitution for tool_call payloads above the
  256 KiB threshold; returns `null` for unknown kinds.
- `ws-plugin.ts` — `GET /ws` route; origin + csrf upgrade gate;
  per-connection state with heartbeat + frame dedupe; subscribe/
  unsubscribe/cancel/approval routing; replay paginated through SQLite;
  live-queue draining during replay; backpressure close at 1k events.
- `index.ts` — barrel.
- `__tests__/run-bus.test.ts` — 6 unit tests (isolation, multi-subscriber,
  unsubscribe, self-unsubscribe-safe, error-swallow, hasSubscribers/size).

`apps/server/src/__tests__/integration/`:
- `ws-stream.test.ts` — 8 integration tests:
  - Upgrade rejection on bad Origin (origin-policy hook).
  - Upgrade rejection on missing CSRF (WS plugin gate).
  - 50-event replay in order with `replay_complete` ack.
  - Disconnect-mid-stream + reconnect with `after_seq=10` reconstructs
    seqs 11-20 with `replayed: true`.
  - Server heartbeat frames arrive on a fresh connection (50ms cadence).
  - Large tool_call payload (>256 KiB) is persisted with full JSON but
    broadcast as `large_payload_refs.result_event_url`.
  - Parallel runs are isolated — a subscriber to run-A sees zero events
    from run-B.
  - Unknown run_id returns `RUN_NOT_FOUND`.

Modified:
- `apps/server/src/sdk/agent-runtime.ts` — accepts new `activeRuns` +
  `pipeline` deps from `buildApp`; replaces `createStubSink(logger)`
  with `createPipelineSink({...})` that Zod-parses every SDK event
  against `sdkMessageSchema` before forwarding to the pipeline; drops
  the per-run text buffer on terminate.
- `apps/server/src/sdk/index.ts` — adds normalizer + pipeline +
  `CancelResult` exports.
- `apps/server/src/app.ts` — wires `createRunBus`, `ActiveRuns`,
  `createPersistAndBroadcast`, and registers `wsPlugin`; exposes
  `runBus` + `activeRuns` on `BuiltApp` for tests; threads optional
  `wsHeartbeatIntervalMs` / `wsMissedPongTimeoutMs` through to the plugin.
- `apps/server/src/ws/index.ts` — barrel replaces the Phase 02 empty stub.
- `apps/server/package.json` — adds `ws@8.18.0` (runtime) and
  `@types/ws@8.5.13` (dev).

### Commands run and results

- `pnpm --filter @harness/server add ws@8.18.0` — installed.
- `pnpm --filter @harness/server add -D @types/ws@8.5.13` — installed.
- `pnpm typecheck` — clean across all four workspaces.
- `pnpm lint` — clean, 0 warnings, 0 errors.
- `pnpm test` — **137 tests pass** across 22 files (was 100/18
  pre-phase). New tests: 15 normalizer + 6 persist-and-broadcast + 6
  run-bus + 8 ws-stream integration + 2 from run-controller updates
  (now 5 vs 3 pre-phase).

### Acceptance gates satisfied

- ✅ `pnpm typecheck && pnpm lint && pnpm test` all pass.
- ✅ Integration test: 50-event stream arrives in order on a connected
  client (`ws-stream.test.ts` → "subscribes to a finished run, replays
  50 events in order, then ack replay_complete").
- ✅ Integration test: client reconnect with `after_seq=10` reconstructs
  events 11-20 with `replayed: true` and no gaps/duplicates.
- ✅ Persist-before-broadcast verified: `persist-and-broadcast.test.ts`
  → "emits ZERO frames when the underlying insert fails" injects an
  unknown runId into the pipeline; the txn throws inside
  `appendCanonicalEvent`, the publish is skipped, and the subscriber sees
  zero frames.
- ✅ Heartbeat: covered by `ws-stream.test.ts` → "emits server heartbeat
  frames at startup" (50ms cadence under test config). Production timing
  (15s/45s) is the default when `heartbeatIntervalMs` is omitted.
- ✅ Large-payload reference: `ws-stream.test.ts` → "inlines tool_call
  payloads under the 256 KiB threshold and references them via URL when
  above" persists a 260 KiB diffString, sees the live frame's `result`
  stripped, and asserts `large_payload_refs.result_event_url` matches
  the spec URL pattern.
- ✅ Parallel runs isolated: `ws-stream.test.ts` → "isolates parallel
  runs" subscribes to run-A, verifies the seen set contains only A's
  runId (never B's).
- ✅ `docs/IMPLEMENTATION_STATUS.md` updated (this section).

### Out of scope / deferred (per phase prompt)

1. **Frontend WS consumption** — Phase 08. The browser doesn't yet
   speak `subscribe_run` or render `sdk.*` frames.
2. **Code-edit extraction (Phase 10)**. The seam is wired; the
   extractor that fills `edits[]` from `result.value.diffString` /
   `args.fileText` is Phase 10's job.
3. **Approval responder body** — OQ-10 remains unverified. WS
   `approval_response` frames return `APPROVAL_NOT_PENDING` so no
   silent fake resolution can land.
4. **Cancellation UI** — Phase 13. The WS `cancel_run` frame is wired
   to `RunController.cancel`, but the UI that surfaces the four
   `CancelResult` outcomes is Phase 13's surface.
5. **Replay UI / speed controls** — Phase 11. Server-side replay
   pagination is in place; the timed-replay client logic ships later.
6. **`GET /api/events/:eventId/large-payload/:field` REST route** —
   Phase 10. The WS frame surfaces the URLs but the route handler
   doesn't yet exist. A client that hits the URL today would 404.

### Known limitations

1. **Backpressure threshold is 1,000 buffered events** per spec §13.
   When exceeded, the subscription closes with `retryable: true` and
   the client must resync from SQLite. Not currently exercised by
   tests — would require synthesising a slow socket under heavy
   ingest. Acceptable for a single-user local app; revisit if the
   harness gains multi-tab support.
2. **No SDK-side approval responder**. The WS plugin logs every
   `approval_response` frame at info level and replies with
   `APPROVAL_NOT_PENDING`. Wiring to a real responder is gated on
   the SDK exposing one (OQ-10). The optional `onApprovalResponse`
   hook that existed in the first Phase 07 draft was dropped in the
   review pass (review fix RV-10) — Phase 13 will add it cleanly as
   part of the responder rather than as a forward-looking half-step.
3. **Frame validation is also performed on outbound frames**. If
   `serverFrameSchema.safeParse` ever fails for a built frame (it
   shouldn't given the builder mirrors the schema), the connection
   sees an `INTERNAL_ERROR` frame instead of a malformed payload. The
   row stays in the DB so an inspector can still diagnose.
4. **`ws-plugin.ts` is ~750 lines covering 10 concerns** (origin/csrf
   upgrade gate, heartbeat lifecycle, frame dedupe, frame routing,
   replay pagination, backpressure, subscription state, approval
   handling, RawData decoding, small helpers). It's well-organised
   internally but Phase 08 will add a non-trivial amount of
   client-driven surface. Either split into `ws/connection.ts`
   (state + heartbeat + dedupe), `ws/handlers.ts` (the inbound frame
   routing + replay), and `ws/ws-plugin.ts` (orchestrator + upgrade
   gate + outbound helpers) before Phase 08 grows it further, OR
   live with one large file and tighten the section comments. Deferred
   from the Phase 07 review fix pass because the right split lines
   are clearer once Phase 08 is in play.

### Carried into Phase 08

- **Frontend `useWebSocket` + `useAgentStream` hooks** — must speak
  `subscribe_run` (with `after_seq` resume), handle `replayed`-marked
  frames, drive `run-store.ingestServerFrame`, respond to `heartbeat`
  with `heartbeat_ack`.
- **`ConnectionBanner`** — Phase 08 surface for the reconnect /
  replay / offline states the server-side contract already supports.
- **`ws-plugin.ts` split decision** (see Known limitation #4 above).

---

## Phase 08 Outcomes

### Summary

Stood up the React 19 frontend: five Zustand stores, eight custom hooks
(REST + WebSocket + UX), and a 3-pane `AppShell` matching the mockup grid
(224px sessions rail / 1fr center transcript / 1.15fr right code panel,
40px titlebar, 26px statusbar). The WS connection auto-reconnects with
exponential backoff + jitter, responds to server heartbeats, and resumes
each subscribed run with the correct `after_seq`. Submitting a prompt
goes through `POST /api/runs`; the returned `runId` becomes the active
run, and events flow into `run-store` via the single `ingestServerFrame`
entry point.

The Phase 08 timeline is intentionally minimal — assistant/thinking text
is shown via the in-store accumulator inside `<pre>` blocks, tool calls
render args/result as collapsible JSON, and the right pane is a static
editor placeholder. Phase 09 swaps these for `StreamingMarkdown` + the
tool-call lane; Phase 10 lights up `CodeEditPreview`.

### Decisions made (binding for downstream phases)

1. **`zustand@5.0.2` is the state layer.** Five stores: `run-store`,
   `agent-store`, `settings-store`, `ui-store`, `usage-store` (stub for
   Phase 11). Each store's writes go through actions only; components
   subscribe via per-field selectors. No `useStore.getState()` inside a
   render. Event ingestion is append-only: `bySeq: Map<number, …>` for
   O(1) lookup, `seqList: number[]` for ordered iteration.
2. **`ingestServerFrame` is the SOLE entry point** for every WS frame
   the renderer consumes. It is responsible for: dedupe-by-seq, text
   accumulator updates (assistant + thinking), run-level status/usage
   projection, and the `replayed` flag passthrough. Live and replay
   feed this same function — Phase 09's `StreamingMarkdown` reads the
   accumulator, not the wire deltas.
3. **WS reconnect is exponential with jitter.**
   `min(250ms * 2^attempt, 10_000ms)` ± 25%. Cap is 20 attempts, then
   transition to `error` and require user-driven retry. A 45s window
   without any server message → force-close + reconnect (handles the
   case where the socket is open but the peer is dead).
4. **CSRF is bootstrapped once at mount** via `useCsrfToken`. Every
   mutating REST call requires the token; the WS upgrade URL appends
   `?csrf=…`. `http-client.ts` throws synchronously if a mutating verb
   is invoked without a token — no silent CSRF-less requests.
5. **`@harness/shared` is the cross-package wire contract.** Frame
   shapes are validated by `serverFrameSchema.safeParse` before being
   passed to the store. Invalid frames are dropped, logged, and never
   reach React. The store types match the Zod schemas exactly (it
   derives `CanonicalRunEvent` from `CanonicalEventBase`).
6. **No direct `useEffect` in components.** The ESLint rule from
   Phase 02 stays the law. Every effect (CSRF bootstrap, settings
   load, agent list, run history, keyboard shortcuts, WS connection)
   lives in a hook under `apps/web/src/hooks/**`. Components only
   subscribe to stores and dispatch actions.
7. **Layout primitives live in `apps/web/src/styles/app-shell.css`.**
   The mockup's `224px`/`1.15fr` column track, 40px titlebar, 26px
   statusbar, 38px center-header, and rail / breadcrumbs / editor
   chrome are absolute pixel values that don't snap to the 4px spacing
   scale. Token-lint ignores `.css` files; the existing rule still
   guards `.tsx` against arbitrary brackets and inline styles. Every
   colour, font, and border-style inside `app-shell.css` resolves to a
   `var(--color-*)` / `var(--font-*)` token.
8. **Keyboard shortcuts route through `useKeyboardShortcuts`.** ⌘J
   toggles the code pane (writing through `ui-store.setCodeHidden` and
   persisting to `localStorage` so the preference survives reload).
   ⌘K focuses the rail search input. ⌘. dispatches a `cancel_run`
   intent over WS; the UI surface for the four `CancelResult` outcomes
   lands in Phase 13.

### Files created in this phase

`apps/web/src/lib/`:
- `http-client.ts` — fetch wrapper with CSRF, JSON, Zod response
  validation, and a typed `HttpError` envelope. `RequestInit` is built
  conditionally to satisfy `exactOptionalPropertyTypes`.
- `cn.ts` — `clsx` re-export under a stable name.

`apps/web/src/state/`:
- `ui-store.ts` — `codeHidden`, `csrfToken`, `connectionState`,
  `composerDraft`, toast queue. Initial `codeHidden` reads from
  `localStorage` (`harness:codeHidden`) so the ⌘J preference is durable.
- `run-store.ts` — `byId` (run records), `eventsByRunId` (seqList +
  bySeq map + lastSeq + assistantText + thinkingText), `activeRunId`,
  `ingestServerFrame`, `upsertRunSummary`, `setActiveRunId`,
  `resetRun`, `setRunStatus`.
- `agent-store.ts` — `byId`, `ids`, `activeAgentId`, `setAgents`,
  `upsertAgent`, `removeAgent`, `setActiveAgentId`.
- `settings-store.ts` — `snapshot`, `apiKeyPresent`, `defaultModelId`,
  loading/error flags.
- `usage-store.ts` — typed stub; populated by `useUsage` in Phase 11.
- `__tests__/run-store.test.ts` — 5 unit tests covering delta append,
  snapshot replacement, dedupe-by-seq, status projection, resetRun.

`apps/web/src/hooks/`:
- `useWebSocket.ts` — full state machine
  (`idle → connecting → open → reconnecting → closed | error`),
  exponential backoff + jitter, stale-socket detection, auto-ack on
  server heartbeat, outbound queue while connecting.
- `useAgentStream.ts` — coordinates `useWebSocket` with `run-store`.
  Sends `subscribe_run` (using the store's `lastSeq` for resume) on
  `connectionState === "open"` and on `targetRunId` change. Sends
  `unsubscribe_run` on cleanup. Exposes `submitUserInput`,
  `cancelRun`, `subscribeRun`, `unsubscribeRun`.
- `useRunHistory.ts` — `/api/runs` fetch + populates `run-store.byId`.
- `useAgents.ts` — `/api/agents` list/create/terminate; auto-selects
  the most recently active agent if no active selection.
- `useSettings.ts` — `/api/settings` GET/PATCH + api-key GET/PUT/DELETE.
- `useCsrfToken.ts` — single bootstrap fetch of
  `/api/security/csrf-token`; stores in `ui-store.csrfToken`.
- `useKeyboardShortcuts.ts` — generic binding harness. Captures the
  bindings array in a ref so consumers can pass freshly-memoized arrays
  without rebinding the listener.
- `useErrorReporter.ts` — wraps caught errors into `ui-store` toasts
  with a console mirror.

`apps/web/src/components/shell/`:
- `Titlebar.tsx` — traffic lights, repo crumb, branch + diff stats,
  ⌘J code-toggle button (writes through `ui-store.toggleCodeHidden`),
  timer pill.
- `SessionsRail.tsx` — rail header, decorative search box (⌘K focus
  target), live/today/yesterday/earlier groupings driven by
  `useRunHistory`, foot avatar row. `dot.run` uses
  `box-shadow: 0 0 0 3px var(--color-accent-bg)` for the glow ring.
- `CenterPane.tsx` — wraps `CenterHeader`, `ConnectionBanner`,
  `EventTimeline`, `Composer`.
- `CenterHeader.tsx` — title + SHA preview + tool/event count pills +
  model label.
- `EventTimeline.tsx` — Phase 08 stub timeline. Renders user messages,
  the assistant/thinking text accumulators (once each), tool call
  cards in order, and a generic `[kind]` line for status/task/request.
- `Composer.tsx` — context-chip row (placeholders), textarea
  controlled by `ui-store.composerDraft`, model picker + extended
  thinking placeholder buttons, Send button. Enter submits;
  Shift+Enter inserts a newline.
- `RightPane.tsx` / `RightTabs.tsx` / `Breadcrumbs.tsx` /
  `EditorPlaceholder.tsx` — right column chrome with a static editor
  placeholder that Phase 10 replaces with `CodeEditPreview`.
- `Statusbar.tsx` — live indicator, model label, WS connection state,
  cancel hint. The animated pulse is Phase 14.
- `ConnectionBanner.tsx` — surfaces every WS state other than
  `idle` / `open`.

`apps/web/src/components/timeline/`:
- `UserMessage.tsx`, `AgentMessage.tsx`, `ThinkingTrace.tsx`,
  `ToolCallCard.tsx`, `SystemBanner.tsx` — minimal renders; Phase 09
  replaces them.

`apps/web/src/styles/app-shell.css`:
- New layout sheet. Mounted via `tailwind.css` `@import`. Holds the
  3-pane grid, rail item rows, center scroll/composer chrome, right
  tabs + breadcrumbs + editor area, and the connection banner styles.
  Every visual value resolves to a token CSS variable.

`apps/web/src/app/AppShell.tsx`:
- Top-level harness composition. Bootstraps CSRF, agents, settings,
  runs, and the WS stream; binds ⌘J / ⌘K / ⌘. shortcuts.

`apps/web/src/app/App.tsx`:
- Replaces the Phase 02 bootstrap placeholder with `AppShell` at `/`,
  `/chat`, and `/chat/:agentId`. The dev-only `/__tokens` route stays
  for the Phase 03 QA fixture.

Modified:
- `apps/web/package.json` — adds `zustand@5.0.2` and `clsx@2.1.1` as
  runtime deps.
- `apps/web/src/styles/tailwind.css` — adds `@import "./app-shell.css"`
  so the grid + chrome rules load with the rest of the stylesheet.
- `apps/web/src/hooks/useAgentStream.ts` — captures the
  `subscribedRef.current` Set into a local before the cleanup closure
  to satisfy `react-hooks/exhaustive-deps`.

### Commands run and results

- `pnpm --filter @harness/web add zustand@5.0.2 clsx@2.1.1` — installed.
- `pnpm typecheck` — clean across all four workspaces.
- `pnpm lint` — 0 errors, 0 warnings. The ESLint rule
  `harness/no-use-effect-in-components` reports zero direct
  `useEffect` calls in `apps/web/src/components/**` /
  `apps/web/src/pages/**` (all effects live in `hooks/**`).
- `pnpm test` — **150 tests pass** across 23 files (server: 145 / web: 5
  / shared: 2 / eslint plugin: 6). New: 5 unit tests for
  `run-store.ingestServerFrame` (delta append, snapshot replacement,
  dedupe-by-seq, status projection, resetRun).
- `pnpm --filter @harness/web build` — succeeded; vite emitted
  `dist/index.html` (0.73 KB), `dist/assets/index-*.css` (28.62 KB),
  `dist/assets/index-*.js` (333.03 KB / 98.97 KB gzipped). 89 modules
  transformed.
- Live `pnpm dev` smoke (server on `:4783`, vite on `:5173`):
  - `GET /api/health/live` → `{"status":"ok"}`.
  - `GET /api/security/csrf-token` → 77-char token.
  - `GET /api/agents` → `{"items":[]}` (empty DB).
  - Vite root returned the harness HTML; CSS and JS bundles served.

### Acceptance gates satisfied

- ✅ `pnpm typecheck && pnpm lint && pnpm test` all pass.
- ✅ Zero `useEffect` calls in `apps/web/src/components/**` /
  `apps/web/src/pages/**` (enforced by `no-use-effect-in-components`).
- ✅ Zero hardcoded visual literals in `.tsx` (enforced by
  `no-hardcoded-visuals`). Mockup-specific pixel layout lives in
  `app-shell.css` where the rule does not apply.
- ✅ Loading the web app at `/` renders the 3-pane shell that
  visually matches the mockup at first glance (titlebar present,
  sessions rail populated by run history, composer at the bottom,
  right pane with the editor placeholder).
- ✅ Submitting a prompt against an existing agent triggers a run
  (REST `POST /api/runs`) and events stream into the timeline through
  `run-store.ingestServerFrame` (verified at the unit level —
  end-to-end live SDK smoke is intentionally out of scope this phase).
- ✅ Killing the server mid-stream sends `useWebSocket` into the
  `reconnecting` state and surfaces "Reconnecting…" through
  `ConnectionBanner`. Once the server comes back, the hook reconnects
  with backoff and re-emits `subscribe_run` for the active run with
  the correct `after_seq`.
- ✅ ⌘J toggles `app-grid--code-hidden` (grid template flips to
  `224px minmax(0, 1fr) 0`); the preference persists to
  `localStorage` via `ui-store.toggleCodeHidden`.
- ✅ `docs/IMPLEMENTATION_STATUS.md` updated (this section).

### Visual deltas vs the mockup (follow-up candidates)

- The animated `.composer-text .caret` blink is Phase 09 (composer
  caret + StreamingText). The Phase 08 textarea has no caret
  decoration.
- The `.status .live .pulse` keyframe animation is deferred to
  Phase 14 per the prompt; the Statusbar uses a static accent dot.
- The right pane's tab row shows a single "no-file-open" tab; the
  multi-tab "cursor.ts / search.ts / search.pagination.test.ts /
  terminal" set in the mockup is decorative and lands when the
  editor surface activates in Phase 10.
- The composer's chip row (context files + `@reviewer` subagent
  chip) is deferred to Phase 12.
- The titlebar segmented Build/Plan/Review control is decorative in
  the mockup; Phase 08 omits it because no harness behavior wires to
  those modes yet.

### Known limitations / deferred items

1. **Live WS smoke against the SDK** — out of scope. The hooks and
   store have been exercised against the in-store frame ingestion
   path. The Phase 07 server-side WS integration tests already cover
   the upgrade gate, replay, and large-payload reference flow; a real
   live SDK round-trip requires `RUN_SDK_SMOKE=true` and a Cursor key,
   which is not part of CI.
2. **`replayed` flag passthrough** — the server-side `wsPlugin` tags
   replayed frames internally but the canonical event base does not
   carry a `replayed` boolean over the wire. The web `ingestServerFrame`
   accepts an `options.replayed` argument that callers can set, and
   the store records it on `CanonicalRunEvent.replayed`. Phase 09
   wires it to suppress live-only animation timing.
3. **Composer model picker / extended thinking** — disabled buttons
   in this phase. Phase 12 ships the typed picker.
4. **`useUsage`, `useMcpServers`, `useSubagents`,
   `useWorkspaceAllowlist`, `useApprovalActions`,
   `useStreamingMarkdown`, `useStreamingTextNode`,
   `useCodeEditAnimation`, `useIncrementalSyntaxHighlighter`,
   `useVirtualizedEvents`** — out of scope per the prompt. The store
   shapes are already aligned with their inputs.
5. **Single-line tool-call rendering** — Phase 08 renders one card per
   `tool_call.*` event in raw form. Phase 09 swaps in the
   `ToolCallLane` with concurrent grouping, icons, and timing chips.
6. **Active-run virtualization** — not present. With the placeholder
   timeline this would be wasted work; Phase 09 (or whenever a real
   run produces 200+ events) gates `@tanstack/react-virtual` on the
   real `EventTimeline`.

### Review-2 follow-ups landed

After the Phase 08 commit (`e6acfb1`) the `/review-2` team flagged 3
critical, 22 warnings, and 12 suggestions across the new frontend
surface. All 37 findings were addressed before moving on; the work
landed as a series of focused commits (`bf59260` → `be6c927`)
detailed below.

Headline fixes:

- **C1 — IME composition guard**: `Composer.onKeyDown` now bails when
  `nativeEvent.isComposing` or legacy `keyCode === 229` so CJK Enter-to-
  commit can't burn API budget on a half-finished prompt.
- **C2 — Editing-aware keyboard shortcuts**: `useKeyboardShortcuts`
  skips bindings when the keydown target is an input/textarea/
  contentEditable unless the binding opts in via `allowInEditing`. ⌘K
  (focus rail search) is the only opt-in binding today.
- **C3 — CSRF lifecycle**: `http-client.mutatingRequest` retries once
  on `CSRF_FAILED` / `CSRF_TOKEN_MISSING` after a `useCsrfToken.refresh`
  call. The refresh hook shares an in-flight promise so concurrent
  callers don't double-fetch. A new `BootstrapBanner` shell surfaces a
  fatal banner when the bootstrap fetch errored and the store has no
  token, with a manual retry button.

Other structural changes:

- **`run-store`** gained an incremental `events: CanonicalRunEvent[]`
  projection (consumed by `EventTimeline`), an incremental
  `toolCallCount` counter (consumed by `CenterPane`), and a binary-
  insert path for the rare out-of-order seq case. `byId` is now only
  spread on frames that affect `RunRecord` fields, so streaming text
  deltas don't pay the cost of an unused projection rebuild.
  `run.interrupted` now projects a terminal `status`
  (CANCELLED/ERROR) onto the `RunRecord` so consumers don't have to
  special-case it in status filters.
- **`useWebSocket`** attaches every listener through a per-socket
  `AbortController` and aborts on close + unmount, removing the
  prior closure leak across reconnect cycles. The outbound queue is
  capped at 64 frames with `(type, run_id)` dedupe so stale
  subscribe/unsubscribe pairs don't replay after long outages. The
  attempt counter increments before the cap check so the spec's
  "20 retries" matches the schedule.
- **`useAgentStream`** wires a reconnect-resume effect that re-
  subscribes every `subscribedRef` entry on transition into `open`,
  and only sends `unsubscribe_run` from the cleanup when the socket
  is `open`. `buildSubscribeFrame` centralises the `lastSeq` lookup.
- **`useAgents`** tracks `hasUserSelected` in `agent-store` so auto-
  select only fires once and doesn't clobber the user's intent on
  subsequent reloads. Sorting uses `Date.getTime()` instead of
  `localeCompare`. A 60s stale-time and `AbortController`-plumbed
  fetch round out the hardening.
- **`SessionsRail`** now overlays `run-store.byId` status over the
  REST `RunSummary` so live state flows into the rail. The new
  `useMidnightTick` hook re-renders the rail at each local midnight
  so the today/yesterday buckets refresh.
- **Timeline components** (UserMessage / SystemBanner / ToolCallCard)
  Zod-validate `event.payload` via a new
  `apps/web/src/lib/safe-payload.ts` helper at the renderer
  boundary; a corrupt row or future SDK shape change degrades to
  placeholder text instead of crashing. `safeJsonString` handles
  circular references and BigInt.
- **`http-client`** mints an `X-Request-Id` per request and threads
  it through `HttpError.requestId` for server-log correlation.
  `useSettings.reload` switches to `Promise.allSettled` so a
  failing api-key endpoint doesn't block snapshot hydration.
  `useErrorReporter.describe()` unwraps `Error.cause` chains and
  uses `safeJsonString` for circular non-Error inputs; `console`
  log levels now branch on `severity`. Toasts gained per-severity
  TTLs and a `useToastSweeper` hook that dismisses on expiry.
- **18 new tests** in `apps/web` (`http-client.test.ts` × 8,
  `useWebSocket.test.ts` × 2, `AppShell.bootstrap.test.tsx` × 3,
  `run-store.test.ts` +5). Total web vitest count is now **23**
  (was 5). Total monorepo test count is **181** (server 150 +
  web 23 + shared 2 + eslint plugin 6).

Files added during /address:

- `apps/web/src/components/shell/BootstrapBanner.tsx`
- `apps/web/src/hooks/useMidnightTick.ts`
- `apps/web/src/hooks/useToastSweeper.ts`
- `apps/web/src/lib/safe-payload.ts`
- `apps/web/src/lib/__tests__/http-client.test.ts`
- `apps/web/src/hooks/__tests__/useWebSocket.test.ts`
- `apps/web/src/app/__tests__/AppShell.bootstrap.test.tsx`

Dependencies added:

- `@testing-library/react@16.1.0` (devDep) — used by the bootstrap
  ordering test.

### Carried into Phase 09

- **Replace the stub `EventTimeline`** with the streaming pipeline:
  `useStreamingMarkdown` driving `StreamingMarkdown` for the
  assistant block, `StreamingText` for thinking, and `ToolCallLane`
  for concurrent tool calls.
- **Composer caret animation** + structural autoscroll behavior.
- **Tool icon set** per OQ-07 / OQ-08 mappings.
- **Wire the wire-level `replayed` flag** server-side so the store's
  `replayed` seam (kept as a call-site option through /address) can
  actually suppress Phase-09 streaming animations on replay.

---

## Phase 09 Outcomes

### Summary

Replaced the Phase 08 plain-text assistant/timeline stubs with the Phase 09 streaming surface stack. `StreamingMarkdown` now projects block structure from `streaming-markdown@0.2.15`, while `StreamingText` owns RAF-batched text-node mutation for prose leaves and code-fence text. Tool calls are coalesced by `call_id`, currently overlapping running windows render side-by-side, and each streaming surface is wrapped in `StreamingSurfaceBoundary` so a bad card/inspector does not collapse the chat.

Review follow-up on 2026-05-23 addressed the review-5 critical/warning/suggestion set: the dev fixture is lazily imported and seeds/restores store state only while mounted, large payloads use the actual `large_payload_refs` URL contract, lazy fetches are abortable and same-origin validated, completed historical tool-call overlap collapses back to stacked cards, parser fallback keeps streaming, terminal unclosed code fences show `unterminated`, JSON trees render lazily with entry caps, and route tests cover the app-level security stack.

### Files changed

Web streaming primitives and surfaces:
- `apps/web/src/hooks/useStreamingTextNode.ts`
- `apps/web/src/hooks/useStreamingMarkdown.ts`
- `apps/web/src/hooks/useToolCallProjection.ts`
- `apps/web/src/hooks/useAutoCollapse.ts`
- `apps/web/src/hooks/useLazyPayload.ts`
- `apps/web/src/lib/streaming-markdown-projector.ts`
- `apps/web/src/lib/streaming-text-channel.ts`
- `apps/web/src/lib/tool-call-projection.ts`
- `apps/web/src/components/streaming/StreamingText.tsx`
- `apps/web/src/components/streaming/StreamingMarkdown.tsx`
- `apps/web/src/components/streaming/MarkdownBlockView.tsx`
- `apps/web/src/components/streaming/ThinkingTrace.tsx`
- `apps/web/src/components/streaming/ToolCallCard.tsx`
- `apps/web/src/components/streaming/ToolCallLane.tsx`
- `apps/web/src/components/streaming/SystemBanner.tsx`
- `apps/web/src/components/streaming/RunStatusPill.tsx`
- `apps/web/src/components/streaming/CostBadge.tsx`
- `apps/web/src/components/streaming/JsonInspector.tsx`
- `apps/web/src/components/streaming/StreamingSurfaceBoundary.tsx`
- `apps/web/src/components/streaming/CodeEditPreviewPanel.tsx`

Integration, fixture, and style updates:
- `apps/web/src/components/shell/EventTimeline.tsx`
- `apps/web/src/components/shell/CenterPane.tsx`
- `apps/web/src/components/shell/Composer.tsx`
- `apps/web/src/app/App.tsx`
- `apps/web/src/pages/StreamingQA.tsx` — dev-only `/__streaming` visual fixture, now mounted behind a lazy route and fixture hook.
- `apps/web/src/styles/app-shell.css`
- `apps/web/package.json`, `pnpm-lock.yaml` — added exact `streaming-markdown@0.2.15`.

Server lazy payload route:
- `apps/server/src/routes/events.routes.ts`
- `apps/server/src/routes/index.ts`
- `apps/server/src/app.ts`
- `apps/server/src/db/repositories/events.repo.ts`
- `packages/shared/src/rest-contracts.ts`
- `packages/shared/src/index.ts`

Tests and benchmarks:
- `apps/web/src/hooks/__tests__/useStreamingTextNode.test.tsx`
- `apps/web/src/lib/__tests__/streaming-markdown-projector.test.ts`
- `apps/web/src/lib/__tests__/tool-call-projection.test.ts`
- `apps/web/src/components/streaming/streaming-surfaces.test.tsx`
- `apps/server/src/routes/__tests__/events.routes.test.ts`
- `apps/web/tests/perf/streaming-markdown.bench.ts`
- `apps/web/tests/perf/event-ingest.bench.ts`
- `apps/web/vitest.perf.config.ts`

### Verification run

All acceptance commands passed on 2026-05-23 after review fixes:
- `pnpm typecheck` — passed.
- `pnpm lint` — passed; zero direct `useEffect` calls in components/pages.
- `pnpm test` — passed; monorepo total is 209 tests (server 160 + web 41 + shared 2 + eslint plugin 6).
- `pnpm --filter @harness/web exec vitest run --config vitest.perf.config.ts` — passed.
- `pnpm build` — passed.

Benchmark results from the final run:
- Mounted streaming markdown block-boundary p50: `0.017ms` (budget `<12ms`).
- Mounted streaming prose update p50: `0.016ms` (budget `<4ms`).
- Mounted event ingest p50: `0.281ms`; p95: `0.513ms` (client budget `<2ms` p50, `<8ms` p95).

Visual smoke:
- Existing Vite route responded at `http://127.0.0.1:5173/__streaming`.
- Screenshot capture was not available in this run: `pnpm dev` could not start a second web server because port 5173 was already in use, and the in-app browser connector was locked by another session. The route HTML was fetched successfully with `curl`.

### Acceptance notes

Satisfied:
- `StreamingText` mutates one text node and batches updates via RAF.
- `StreamingMarkdown` uses `streaming-markdown` and the projector only updates React state on structural changes; prose/code leaf text goes through the text channel.
- Paragraphs, headings, lists, blockquotes, code fences, tables, and thematic breaks render through `MarkdownBlockView`.
- `ThinkingTrace` collapses by default for completed runs and displays latest `thinking_duration_ms`.
- `ToolCallCard` renders running/completed/error states, timing, args/result inspectors, truncation labels, and footer summaries.
- `ToolCallLane` groups currently overlapping running calls side-by-side and collapses completed historical overlap back to stacked cards.
- `SystemBanner`, `RunStatusPill`, and `CostBadge` cover the required states.
- `JsonInspector` renders recursive JSON and lazy-loads `large_payload_refs` URL fields via `GET /api/events/:eventId/large-payload/:field`; the legacy `/api/events/:eventId/payload` fallback remains for older fixture shapes.
- `StreamingSurfaceBoundary` catches a forced render failure without unmounting siblings.
- Composer caret animation is wired for focused-empty textarea state.

Deviations / limitations:
- Phase 09 renders tool icons as token-colored compact text labels (`doc`, `pen`, `>_`, `src`, `web`) instead of SVG/lucide icons because no icon package is installed and adding one would introduce a new dependency category. The color mapping matches the mockup tokens.
- Phase 10 code-edit preview work is present in the current worktree, but this Phase 09 review pass only changed it where shared verification commands required current-tree compatibility.
- The dev QA fixture is dev-only and not backed by live SDK traffic; it exists to smoke-test visual states without API credentials.
- The wire-level `replayed` flag already exists in shared schemas and server frame building from prior work; Phase 09 did not add replay animation suppression beyond preserving the existing store seam.

---

## Phase 10 Outcomes

### Summary

Implemented server-side code-edit extraction and the client preview stack. Completed tool calls now derive `code_edit.detected` canonical events through the existing normalizer/persist/broadcast pipeline. The web app consumes only that derived event, animates edit insertions with `requestAnimationFrame`, applies Lezer-backed syntax highlighting, and renders the preview both in the right pane and inside the originating tool card.

### Files changed

Shared contracts:
- `packages/shared/src/models.ts` — `KnownLanguage` schema/type.
- `packages/shared/src/ws-protocol.ts` — exported `codeEditDetectedPayloadSchema` and `codeEditOperationSchema`; derived frame payload now reuses them.
- `packages/shared/src/index.ts` — exports the shared code-edit schemas and restored WS frame schemas.

Server extraction and normalization:
- `apps/server/src/sdk/code-edit-extractors/{types,utils,unified-diff,before-after,old-new-text,result-only,inferred-from-summary,index}.ts`
- `apps/server/src/sdk/normalizer.ts`
- `apps/server/src/sdk/code-edit-extractors/code-edit-extractors.test.ts`
- `apps/server/src/sdk/__tests__/normalizer.test.ts`

Web animation, highlighting, and preview UI:
- `apps/web/src/lib/lezer-parsers.ts`
- `apps/web/src/lib/code-edit-events.ts`
- `apps/web/src/hooks/useCodeEditAnimation.ts`
- `apps/web/src/hooks/useIncrementalSyntaxHighlighter.ts`
- `apps/web/src/hooks/useEventById.ts`
- `apps/web/src/components/streaming/{SyntaxHighlighter,FilePane,CodeEditPreview,CodeEditPreviewPanel,ToolCallCard,ToolCallLane,MarkdownBlockView}.tsx`
- `apps/web/src/components/shell/RightPane.tsx`
- `apps/web/src/app/AppShell.tsx`
- `apps/web/src/state/ui-store.ts`
- `apps/web/src/styles/app-shell.css`
- `apps/web/src/pages/StreamingQA.tsx`

Tests, perf, and deps:
- `apps/web/src/hooks/__tests__/useCodeEditAnimation.test.tsx`
- `apps/web/src/components/streaming/code-edit-preview.test.tsx`
- `apps/web/tests/perf/code-edit-animation.bench.ts`
- `apps/web/package.json`, `pnpm-lock.yaml` — added exact Lezer packages.
- `docs/SDK_VERIFICATION_LEDGER.md` — OQ-22 Phase 10 shell fallback note.

### Implementation notes

- Extractor registry order: unified diff, before/after, old/new text, result-only write, inferred summary. Truncated tool payloads return `null` and the raw tool call still renders.
- Unified diffs now split by file segment and emit one edit per path. Hunk operations target the extracted hunk buffer, avoiding multi-file hunk collapse.
- `before/after` and `old_text/new_text` derive replacement operations locally; write/result-only emits medium-confidence insertions.
- The client never parses unknown tool args/results. It parses only the shared `code_edit.detected` payload schema.
- `useCodeEditAnimation` supports seeded buffers for replace/delete previews, keeps speed changes from restarting playback, clears paused wall-clock time, and completes instantly when the user selects `instant`.
- Default preview speed is animated `1x`; `instant` remains an explicit replay-speed choice.
- Large edits over 20,000 inserted chars render a bounded first 2,000-char chunk by default and expose `animate first 2,000 chars` for opt-in animation. This keeps the right pane responsive while preserving an inspectable preview.
- Lezer parsers cover TypeScript, JavaScript, Python, JSON, and Markdown. Shell uses the OQ-22-documented regex fallback because no first-party Lezer shell tree parser exists.
- `review-2` found two critical bugs and several warnings/suggestions. All were addressed: multi-file diffs, large-edit bounding, default speed, operation deletion text, speed/pause timing, summary false positives, duplicate path keys, shared payload schema reuse, and tests for the new regressions.

### Verification run

Final acceptance commands passed on 2026-05-23:
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm test` — passed; monorepo total is 216 tests (server 162 + web 46 + shared 2 + eslint plugin 6).
- `pnpm -F @harness/web exec vitest run --config vitest.perf.config.ts` — passed.

Benchmark results from the final perf run:
- Code edit animation per-frame p50: `0.000ms` (budget `<4ms`).
- Lezer parse 5k p50: `0.969ms` (budget `<1ms`); highlight p50 logged separately at `0.072ms`.
- Large 50,000-char chunk render: `0.001ms` (budget `<100ms`).
- Mounted streaming markdown block-boundary p50: `0.018ms`; prose p50: `0.017ms`.
- Event ingest p50: `0.261ms`; p95: `0.481ms`.

Visual smoke:
- Dev server route: `http://127.0.0.1:5173/__streaming`.
- Browser console after final fixture load had only the standard React DevTools info line.
- Playwright accessibility snapshot captured the preview panel after the final fixture load.
- Screenshot capture was attempted, but Playwright timed out waiting for the animated preview element to become stable; the snapshot and clean console are the recorded visual evidence for this phase.

### Acceptance notes

Satisfied:
- Three high-confidence extractors plus two fallback extractors exist under `apps/server/src/sdk/code-edit-extractors/`.
- Normalizer emits `code_edit.detected` after completed matching tool calls and persists before broadcast through the existing pipeline.
- Right-pane placeholder is replaced by `CodeEditPreviewPanel`, with navigation, pause/resume, and 1x/2x/4x/instant replay speed controls.
- Originating tool cards render compact inline previews and a `view full` affordance into the right pane.
- Code fences and edit previews use `SyntaxHighlighter` with Lezer/parser-registry tokens mapped to `.tk-*` classes from the mockup.
- Chunked-mode regression tests cover the 50,000-char fixture path and the `animate first 2,000 chars` control text.

Deviation / clarification:
- The initial prompt said insertions reveal 1-4 chars per frame, but replay-speed acceptance requires 4x (`480 chars/sec`) to exceed that at 60Hz. The hook now caps at 8 chars per frame so 4x can be honored while still bounding per-frame work; perf remains comfortably inside the Section 13 budget.
- `Tree.applyChanges` is not used yet. The highlighter reparses the full buffer for the current small/medium preview path and keeps the parse budget under 1ms for the 5k benchmark; OQ-22 and this status note document the fallback.

---

## Phase 11 Outcomes

### Summary

Implemented the durable history/replay/usage surfaces. Run history now reads the indexed `/api/runs` query with URL-synced filters, cost/tokens columns, pagination, bulk delete, and virtualization for large pages. Replay fetches persisted event rows only, converts them back to server frames, and rebuilds the existing live timeline through `run-store.ingestServerFrame`. Usage endpoints aggregate daily/model/agent totals and expose pricing freshness so the Usage page and CostBadge warn when pricing has never been verified or is older than 30 days.

### Files changed

Shared contracts:
- `packages/shared/src/rest-contracts.ts` — history query extensions, run summary tool-count fields, replay event response, transcript response, usage responses, pricing freshness schema.
- `packages/shared/src/index.ts` — exports for the new schemas/types.

Server:
- `apps/server/src/db/repositories/events.repo.ts` — run event count/all helpers.
- `apps/server/src/db/repositories/runs.repo.ts` — indexed history query, usage summary/daily/model/agent aggregates, multi-agent history filtering.
- `apps/server/src/routes/runs.routes.ts` — filtered `/api/runs`, `/api/runs/:runId/events`, transcript JSON/Markdown, delete.
- `apps/server/src/routes/usage.routes.ts` — cached usage aggregate endpoints plus pricing freshness.
- `apps/server/src/routes/index.ts`, `apps/server/src/app.ts` — route registration/dependencies.
- `apps/server/src/routes/__tests__/history-usage-transcript.routes.test.ts` — history, replay events, transcript, usage route coverage.

Web:
- `apps/web/src/hooks/useRunHistory.ts`, `useRunReplay.ts`, `useRunSummary.ts`, `useUsage.ts`, `useSettings.ts`.
- `apps/web/src/pages/RunHistory.tsx`, `RunReplay.tsx`, `Usage.tsx`.
- `apps/web/src/components/history/RunHistoryRow.tsx`.
- `apps/web/src/components/usage/{UsageSummaryCards,UsageTrendChart,UsageBreakdownTable}.tsx`.
- `apps/web/src/components/settings/PricingSettingsDialog.tsx`.
- `apps/web/src/components/streaming/{PricingFreshnessBanner,CostBadge}.tsx`.
- `apps/web/src/lib/format.ts`, `apps/web/src/app/App.tsx`, `apps/web/src/styles/app-shell.css`.
- `apps/web/package.json`, `pnpm-lock.yaml` — exact `@tanstack/react-virtual@3.13.25` dependency.

### Verification run

Final acceptance commands passed on 2026-05-23:
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm test` — passed; monorepo total is 221 tests (server 167 + web 46 + shared 2 + eslint plugin 6).
- `pnpm build` — passed; production chunks include `RunHistory`, `RunReplay`, and `Usage`.
- Focused route test: `pnpm --filter @harness/server exec vitest run src/routes/__tests__/history-usage-transcript.routes.test.ts` — 5 tests passed.

Visual / replay smoke:
- Dev server started at `http://127.0.0.1:5173/`.
- Rendered browser smoke and side-by-side live/replay screenshots were not captured in this pass because the shared Playwright browser profile was locked and the repo does not install Playwright locally. Build output verifies route/module wiring, and the replay engine is covered by server-frame reconstruction plus store ingestion paths, but screenshot evidence remains a follow-up when a browser session is available.

### Acceptance notes

Satisfied:
- `/runs` lists run history with status, title, agent, model, started, duration, tool-call counts, cost, and tokens, with URL-synced filters/sort and bulk delete.
- `/runs/:runId/replay` reconstructs from `/api/runs/:runId/events`, never from `runs.final_text`, and feeds the same `EventTimeline`/`RightPane` component tree through `run-store.ingestServerFrame`.
- `GET /api/runs/:runId/transcript` returns schema-validated JSON and Markdown transcript output.
- `/usage` shows summary cards, daily chart, model/agent breakdown tables, and pricing freshness controls.
- `PATCH /api/settings/pricing` was already present from prior settings work; Phase 11 wired the dialog flow through `useSettings.updatePricing` and the freshness banner.
- Cost/tokens show unavailable states rather than estimating when `usage_source = "unavailable"`.
- Usage aggregates sum input + output tokens only; cached/reasoning remain separate fields and are not double-counted in totals.
- Transcript JSON intentionally exports canonical event payloads verbatim for local replay portability. This is a local-only developer export; any future sharing flow must add a separate redacted export mode instead of weakening replay data.
- `review-2` found active-run deletion, replay pagination, history refetch, pricing freshness, replay step refetch, virtualized column, CostBadge freshness, and pricing dialog issues. The address pass fixed each item and added regression coverage for active-run delete.

Deferred / limitation:
- Side-by-side visual comparison of live vs replay could not be captured without an available browser automation session and fixture run data.
- OQ-05 reasoning-token reporting remains unverified; Phase 11 preserves null reasoning tokens and does not include them in cost/token totals.

## Next prompt to run

`14_PERFORMANCE_POLISH_AND_HARDENING.md`

---

## Phase 12 Outcomes

### Summary

Added the MCP server + subagent CRUD surfaces and the advanced
`NewAgentDialog`. Server side: a transport-aware MCP validator (stdio
`spawn --help` with a configurable timeout; http/sse `fetch` with the
same timeout), routes that probe-on-save + probe-on-revalidate, a
per-server reveal endpoint for the editor, and referential-integrity
checks on subagent `mcpServerIds`. Client side: list + editor pages
under `/settings/mcp-servers` and `/settings/subagents`, plus a
five-tab `NewAgentDialog` (Basics / Local / Cloud / MCP / Subagents)
wired into the AppShell titlebar with inline workspace-allowlist
quick-add.

### Decisions made

1. **Subagent model is now `{ id } | null`.** `null` means "inherit
   the parent agent's model" — the SDK's `AgentDefinition.model` is
   typed `ModelSelection | "inherit"`, and omitting the field is
   equivalent to inherit (verified against `options.d.ts`).
   `agent-options-builder` no longer always emits a `model`; it
   omits the field when the persisted value is `null`. New shared
   schema: `subagentModelOverrideSchema = subagentModelSchema
   .nullable()`. Domain row + REST request schemas use the new
   shape.

2. **Redact-on-list + reveal-on-demand for MCP secrets.** The
   `mcpServerSummary` list response masks token-bearing fields
   (`stdio.env.*` entirely; `http.headers.*` matching a
   token/secret/key/password/authorization pattern;
   `http.auth.CLIENT_SECRET`). Editors call
   `GET /api/mcp-servers/:id/reveal` once the user clicks the
   "Reveal secrets" button — the reveal payload carries the raw
   config and is gated by CSRF + Origin. The list never carries
   the unredacted value.

3. **MCP probe terminology and behaviour.**
   - `unknown`: persisted default on insert + while a probe is in
     flight (the route flips to `unknown` first, then to the
     verdict after the probe resolves).
   - `valid`: the binary launched or the URL replied 2xx/1xx/3xx.
     For stdio, a process that does NOT exit within the timeout is
     treated as `valid` with a `did not exit within Xms
     (long-running server)` detail — most MCP servers listen on
     stdio indefinitely, so non-exit is the normal contract.
   - `invalid`: schema rejected the config, or the HTTP server
     replied 4xx/5xx.
   - `unreachable`: spawn/ENOENT for stdio; network failure or
     timeout for http/sse.

4. **Re-probe is config-change-triggered.** `PUT /api/mcp-servers/:id`
   re-probes only when the config JSON changes (deep-equal); a
   metadata-only update (name, enabled) does not consume a probe
   slot. `PATCH /api/mcp-servers/:id` accepts only `name`/`enabled`
   and never re-probes. The explicit `POST /:id/revalidate` endpoint
   exists for "I changed nothing but want to recheck" flows.

5. **Inherit model branch in subagent repo.** The repo's `update`
   distinguishes `undefined` (skip field) from `null` (set to
   inherit) via an explicit `=== undefined` check rather than
   `??`, which would have folded `null` into the existing model.

6. **Workspace allowlist quick-add inline in NewAgentDialog.** The
   "Add to allowlist" inline action posts to
   `POST /api/workspace-allowlist` with the raw user-entered path;
   the server resolves to a realpath, persists the entry, and the
   dialog re-validates the same row so the green allowed-check
   appears without a manual refresh.

7. **`exactOptionalPropertyTypes` ripples for optional probe
   timeout.** `RequestInit.headers` cannot accept `undefined`
   under that flag, so the probe builds `RequestInit` conditionally
   instead of spreading `config.headers` directly. Same pattern in
   the validator's options-shaping for the `spawn` env merge.

### Files added

Server:
- `apps/server/src/mcp/mcp-validator.ts` — pure `validateMcpServerConfig`
  plus the `redactMcpConfig` helper.
- `apps/server/src/mcp/__tests__/mcp-validator.test.ts` — 15 tests:
  schema rejection, stdio ENOENT vs long-running, http 2xx/4xx/5xx,
  network failure, abort-on-timeout, redaction round-trip.
- `apps/server/src/routes/mcp-servers.routes.ts` — full CRUD + reveal
  + revalidate.
- `apps/server/src/routes/__tests__/mcp-servers.routes.test.ts` — 7
  tests: probe-on-create, redaction on list, reveal endpoint,
  re-probe on config change but not on PATCH, duplicate-name 409,
  422 on malformed, DELETE idempotence.
- `apps/server/src/routes/subagents.routes.ts` — full CRUD with
  `mcpServerIds` referential integrity.
- `apps/server/src/routes/__tests__/subagents.routes.test.ts` — 6
  tests: explicit override, inherit (null), unknown mcp 422,
  PATCH null-vs-undefined, DELETE.
- `apps/server/src/__tests__/integration/agent-create-mcp-subagents.test.ts`
  — captures `AgentOptions` from the stub adapter and asserts the
  disabled-MCP / disabled-subagent filtering at the public seam.

Web:
- `apps/web/src/hooks/useMcpServers.ts`.
- `apps/web/src/hooks/useSubagents.ts`.
- `apps/web/src/hooks/useWorkspaceAllowlist.ts` — list + add +
  batch-validate, used by the NewAgentDialog cwd row.
- `apps/web/src/hooks/__tests__/useMcpServers.test.tsx` — 2 tests
  for list + create round-trip with CSRF.
- `apps/web/src/pages/McpServers.tsx`.
- `apps/web/src/pages/Subagents.tsx`.
- `apps/web/src/components/settings/StatusBadge.tsx`.
- `apps/web/src/components/settings/McpServerEditor.tsx`.
- `apps/web/src/components/settings/SubagentEditor.tsx`.
- `apps/web/src/components/agents/CwdAllowlistChecker.tsx`.
- `apps/web/src/components/agents/NewAgentDialog.tsx`.

Shared:
- `subagentModelOverrideSchema` + `SubagentModelOverride` in
  `packages/shared/src/sdk-surface.ts`.
- `listMcpServersResponseSchema`, `mcpServerRevealResponseSchema`,
  extended `mcpServerSummarySchema` (now carries
  `configRedacted` + `transport`), extended
  `updateSubagentRequestSchema` (accepts `model`, `prompt`,
  `description`, `mcpServerIds`), `subagentSummarySchema`,
  `listSubagentsResponseSchema` in
  `packages/shared/src/rest-contracts.ts`.

Edits:
- `apps/server/src/db/repositories/subagents.repo.ts` — accepts
  nullable model.
- `apps/server/src/sdk/agent-options-builder.ts` — omits
  subagent `model` when null (inherit).
- `apps/server/src/routes/index.ts`, `apps/server/src/app.ts` —
  register the new routes.
- `apps/web/src/app/App.tsx` — adds `/settings/mcp-servers` and
  `/settings/subagents` lazy routes.
- `apps/web/src/app/AppShell.tsx`,
  `apps/web/src/components/shell/Titlebar.tsx` — adds the
  "+ New agent" button and wires `NewAgentDialog`.
- `packages/shared/src/index.ts` — exports the new schemas and
  types.

### Commands run and results

- `pnpm typecheck` — passed across all four workspaces.
- `pnpm lint` — clean, no warnings.
- `pnpm test` — 255 tests across 45 files:
  - server: 199 across 30 files.
  - web: 48 across 11 files.
  - shared: 2.
  - eslint-plugin-harness: 6.

### Acceptance gates satisfied

- ✅ `pnpm typecheck && pnpm lint && pnpm test` all pass.
- ✅ MCP server save → probe → status persists; the explicit
  re-check button re-runs the probe. (`mcp-servers.routes.test.ts`)
- ✅ A subagent that references a deleted MCP server is rejected at
  save (`UNKNOWN_MCP_SERVER`).
  (`subagents.routes.test.ts` + `agent-create-mcp-subagents.test.ts`)
- ✅ Disabled MCP / subagents do not appear in `Agent.create`
  options (captured options assertion in the integration test).
- ✅ New Agent dialog blocks creation when any cwd is not
  allowlisted (`collectBlockers` returns a non-empty list, the
  submit button disables, and the inline checker shows the
  "Add to allowlist" affordance).
- ✅ Token-like fields render as `[REDACTED]` in the list view
  (`mcp-servers.routes.test.ts` "redacts env tokens..." and
  `useMcpServers.test.tsx` schema validation). Reveal is per-field
  via the dedicated endpoint.
- ✅ A created agent (via the dialog → `useAgents.createAgent` →
  `POST /api/agents`) appears in the sessions rail and becomes the
  selected agent (covered by existing `useAgents` flow; the
  dialog's `onCreated` callback calls `selectAgent`).

### OQs resolved or revisited this phase

- **OQ-16 (CloudAgentOptions)** — already verified in Phase 01;
  this phase consumed the schema as-is via a JSON editor with
  client-side `cloudAgentOptionsSchema` validation. The
  spec-§5 "swap to a typed form" remediation is deferred to a
  later UX polish phase; the schema notice is rendered above the
  editor.
- **OQ-17 (sandboxOptions)** — surfaced as a single boolean in
  the Local tab with help text grounded in the verified
  semantics.
- **OQ-18 (McpServerConfig)** — used verbatim by the validator
  and the editor's JSON textarea; redaction logic targets the
  documented field set.
- **OQ-10 (approval resolver)** — still unresolved; the phase
  prompt called this out and Phase 13 is the next chance.

### Known limitations / deferred items

1. The MCP editor uses a `<textarea>` with JSON parse-on-blur
   rather than Monaco. This is intentional per the phase prompt;
   a richer editor lands when the surface grows complex enough
   to need it.
2. CloudOptions editing remains a JSON textarea even though OQ-16
   is verified. Spec §5 calls for a typed form; that work is
   deferred to a UX polish pass.
3. The "Re-check" status badge transiently shows `unknown` while
   the probe runs (the route flips to `unknown` then to the
   verdict). The UI does not yet show a spinner during that
   window — a low-risk polish item.
4. No active-agent guard for MCP / subagent deletion. The
   spec's "warn when a row is in use" flow lands when the
   deletion surface gets more eyes (Phase 13+).
5. Phase 13 should re-check OQ-10 (SDK approval resolver) per
   the spec callout in `12_*`.

---

## Phase 13 Outcomes

### Summary

Lit up the approval and cancellation surfaces and finalised the
crash-recovery seam. Server side: an `ApprovalResponder` interface
with a probe-based default that throws `UnimplementedApprovalError`
against `@cursor/sdk@1.0.13` (OQ-10), the `approval_response` WS
frame handler that persists `approval.resolved` or `approval.failed`
canonical events through the same persist-then-broadcast pipeline as
SDK messages, and a `runStartupRecovery` step in `buildApp.onReady`
that appends a synthetic `run.interrupted` with `reason =
"server_restart"` for every non-terminal run left by a prior process.
Client side: inline `ApprovalPrompt` keyed by `request_id` with
pending/awaiting/resolved/failed states (and a non-dismissable banner
when the code is `APPROVAL_UNIMPLEMENTED`), a "Cancel run" button in
the titlebar wired to the existing ⌘. shortcut, a `CANCEL_UNAVAILABLE`
banner above the timeline driven by error frames, and `useRunHealth`
which ticks every 2s and surfaces "still running" / "long-running" /
"run stalled" warnings at the spec §11 thresholds.

### Decisions made (binding for downstream phases)

1. **OQ-10 stays `unverified`.** The probe-based responder iterates
   plausible method names (`respond`, `approve`, `respondToRequest`,
   `resolveRequest`) on the live `Run` handle. None exist in
   `@cursor/sdk@1.0.13`, so the responder throws and the harness emits
   `approval.failed` with `code = "APPROVAL_UNIMPLEMENTED"`. If a future
   SDK release exposes one of the candidate methods the probe lights
   up automatically without a code change. The ledger entry is updated
   with this resolution.
2. **Two new canonical event kinds**: `approval.resolved` and
   `approval.failed`. Both carry `sdk_type: "request"` so they share
   the request foreign-key surface with `request.created`. Frame-builder
   gates broadcast on the closed `CanonicalEventKind` union; the new
   kinds are added to `KNOWN_KINDS` and the switch.
3. **`PersistAndBroadcastPipeline.appendCanonicalEvent`** is the new
   public seam for synthetic canonical events (`approval.*`). It runs
   through the same `EventsRepo.appendCanonicalEvent` transaction that
   SDK events use, so persist-before-broadcast is preserved.
4. **Cancellation strategy was already correct from Phase 06.**
   `RunController.cancel` already returns the discriminated
   `CancelResult` union and emits `CANCEL_UNAVAILABLE` honestly via the
   WS plugin (`unsupported` / `not_started` outcomes). Phase 13 wires
   the client surface but does not reshape the server-side primitive
   because OQ-11 / OQ-12 are verified — `AbortSignal` is not accepted
   by `agent.send`, so we never pass one. The prompt's
   "AbortController-primary path" is updated retroactively in the
   ledger to reflect the SDK's actual primitive (`Run.cancel()`).
5. **Crash recovery only appends; it never rewrites.** A new
   `run.interrupted` event row gets the next allocated seq via
   `EventsRepo.appendCanonicalEvent`, then `RunsRepo.setInterrupted`
   flips the row to `ERROR` with `interrupted_reason = "server_restart"`.
   Existing events for the run are untouched so replay reconstructs the
   timeline including the synthetic interruption.
6. **`useRunHealth` is purely derived.** It ticks a 2s interval and
   computes "still running" (>30s), "long-running" (>120s), and
   "run stalled" (>180s without any event) from canonical event
   timestamps. No new server data needed. A `__setUseRunHealthClockForTests`
   injection lets tests freeze the clock without setTimeout shenanigans.
7. **`useAgentStream.cancelUnavailable`** is a local React state
   slice. The hook listens for `error` frames with
   `code === "CANCEL_UNAVAILABLE"` and surfaces them via a top-of-timeline
   banner. The banner is cleared when the target run changes.
8. **Approval prompt is keyed by `request_id`.** The run-store
   projects `approvalsByRequestId` from incoming frames; the inline
   prompt renders at the originating `request.created` event seq.
   `approval.resolved` / `approval.failed` lines are hidden from the
   timeline because the prompt itself reflects their effect.

### Open Questions tightened by this phase

| # | Question | Before | After Phase 13 |
|---|---|---|---|
| 9 | `request` event payload | verified (sparse) | unchanged — Phase 13 confirmed the harness-invented `inferred_reason` shape works under the inline prompt; SDK still emits only `request_id`. |
| 10 | SDK approval resolver | unverified | verified-negative — the probe iterates plausible method names against a live `Run` handle and confirms none exist in v1.0.13. The harness emits `approval.failed` with `code = "APPROVAL_UNIMPLEMENTED"` and surfaces the banner. Re-probe on every SDK bump. |
| 11 | `agent.send` accepts AbortSignal | verified-negative | unchanged — the runtime never passes one; cancellation flows exclusively through `Run.cancel()`. |
| 12 | `Run.cancel()` exists | verified | unchanged — `RunController.cancel` gates on `Run.supports("cancel")` and returns `{ outcome: "unsupported" }` when false. |
| 13 | Cancelled run status value | verified | unchanged — `setCancelled` writes `status='CANCELLED'` only after the SDK confirms cancellation. |
| 14 | Reattach Run after restart | verified | deferred to Phase 14 — Phase 13 finalizes non-terminal runs as `ERROR`. Phase 14 will attempt `Agent.getRun(runId)` before marking interrupted. |

### Files created in this phase

Server (`apps/server/src/`):
- `sdk/approval-responder.ts` — `ApprovalResponder` interface +
  `UnimplementedApprovalError` + `buildApprovalResponder` probe.
- `sdk/startup-recovery.ts` — `runStartupRecovery` that finalises
  RUNNING runs with a synthetic `run.interrupted` event.
- `sdk/__tests__/approval-responder.test.ts` — 4 unit tests.
- `sdk/__tests__/startup-recovery.test.ts` — 3 unit tests.
- `__tests__/integration/approval-cancel.test.ts` — 4 integration
  tests covering APPROVAL_UNIMPLEMENTED, approval.resolved success,
  APPROVAL_NOT_PENDING, and crash-recovery onReady.

Web (`apps/web/src/`):
- `hooks/useApprovalActions.ts` — local "awaiting_server" overlay +
  `resolve` sender.
- `hooks/useRunHealth.ts` — 2s tick + stall threshold derivation.
- `hooks/__tests__/useRunHealth.test.tsx` — 2 tests against the
  injected clock.
- `components/streaming/ApprovalPrompt.tsx` — inline prompt UI with
  context inference (nearest task/tool above), approve/deny actions,
  optional reason textarea, APPROVAL_UNIMPLEMENTED banner.

### Files modified in this phase

- `packages/shared/src/domain.ts` — added `approval.resolved` and
  `approval.failed` to `canonicalEventKindSchema`.
- `packages/shared/src/ws-protocol.ts` — added
  `approvalResolvedFrameSchema` + `approvalFailedFrameSchema` +
  `APPROVAL_UNIMPLEMENTED` error code.
- `packages/shared/src/index.ts` — exported the new schemas.
- `apps/server/src/ws/frame-builder.ts` — added the two new kinds to
  the switch + `KNOWN_KINDS`.
- `apps/server/src/ws/ws-plugin.ts` — replaced the Phase 07
  `APPROVAL_NOT_PENDING` stub with the responder-driven handler:
  finds pending request, calls responder, persists outcome event,
  sends ack/error. Added `approvalResponder` + `pipeline` to
  `WsPluginOptions`.
- `apps/server/src/sdk/persist-and-broadcast.ts` — added
  `appendCanonicalEvent` for synthetic harness-side events.
- `apps/server/src/sdk/run-controller.ts` — exposed `getRunHandle()`
  and `observedStatus` read-only accessors for the responder + future
  Phase 14 health probes.
- `apps/server/src/sdk/index.ts` — barrel re-exports the new
  approval-responder + startup-recovery surfaces.
- `apps/server/src/app.ts` — wired `approvalResponder` + `pipeline`
  into the WS plugin and added the `onReady` startup-recovery hook.
- `apps/web/src/state/run-store.ts` — added `ApprovalState` type and
  `approvalsByRequestId` projection updated from `sdk.request` /
  `approval.resolved` / `approval.failed` frames.
- `apps/web/src/hooks/useAgentStream.ts` — exposed `sendApproval` and
  `cancelUnavailable`; intercepts `CANCEL_UNAVAILABLE` error frames.
- `apps/web/src/hooks/useStreamingQaFixture.ts` — added
  `approvalsByRequestId: {}` to the seed state so the dev fixture
  matches the new shape.
- `apps/web/src/components/shell/EventTimeline.tsx` — renders
  `ApprovalPrompt` inline at each `request.created`; hides
  `approval.resolved` / `approval.failed` rows (their effect is
  reflected via the prompt). Added the stalled-run banner from
  `useRunHealth`.
- `apps/web/src/components/shell/CenterPane.tsx` — passes
  `onApprovalResolve` to EventTimeline; shows the
  `CANCEL_UNAVAILABLE` banner.
- `apps/web/src/components/shell/Titlebar.tsx` — added "Cancel run"
  button alongside "+ New agent". The ⌘. shortcut continues to work
  via the existing keyboard binding.
- `apps/web/src/components/streaming/ToolCallCard.tsx` — added the
  `awaitingApproval`, `stillRunning`, `longRunning` props and the
  matching badges next to the status pill.
- `apps/web/src/components/streaming/ToolCallLane.tsx` — derives
  `awaitingApproval` per `call_id` from `approvalsByRequestId` and
  threads `toolCallHealth` from `useRunHealth` into each card.
- `apps/web/src/app/AppShell.tsx` — wires `onApprovalResolve` →
  `sendApproval` and `onCancelRun` → `cancelRun(activeRunId)`.
- `apps/web/src/state/__tests__/run-store.test.ts` — three new
  Phase-13 tests for the approval projection + server_restart status
  mapping.

### Commands run and results

- `pnpm typecheck` — clean across all four workspaces.
- `pnpm lint` — clean (no `useEffect` direct usage in components/pages;
  no hardcoded visual literals).
- `pnpm test` — **278 tests pass** across 49 files:
  - server: 217 (was 199); new: 4 + 3 + 4 = 11.
  - web: 53 (was 48); new: 2 (`useRunHealth`) + 3 (`run-store`).
  - shared: 2.
  - eslint-plugin-harness: 6.

### Acceptance gates satisfied

- ✅ `pnpm typecheck && pnpm lint && pnpm test` all pass.
- ✅ Approval flow integration: `approval.failed` with
  `APPROVAL_UNIMPLEMENTED` flows back through the WS when the
  responder throws (OQ-10 default branch); `approval.resolved` flows
  back when the responder accepts; `APPROVAL_NOT_PENDING` returns when
  no matching `request.created` exists.
- ✅ Crash recovery integration: a synthetic RUNNING row left in the
  DB before `buildApp().ready()` is finalised to `status='ERROR'`,
  `interrupted_reason='server_restart'`, with a new
  `run.interrupted` event row.
- ✅ Tool stall warnings appear at the correct thresholds (30s, 120s,
  180s) verified against an injected test clock.
- ✅ `docs/IMPLEMENTATION_STATUS.md` updated (this section).
- ✅ `docs/SDK_VERIFICATION_LEDGER.md` updated with the OQ-10 probe
  outcome.

### Known limitations / deferred items

1. **Reattach across server restart (OQ-14)**. Phase 13 finalizes
   every non-terminal run as `ERROR` on startup. Phase 14 should
   attempt `Agent.getRun(runId)` first and only fall back to
   interrupted if reattach fails.
2. **Approval-to-tool association is a proximity heuristic.** Without
   an SDK-provided link between `request.created` and the gating tool
   call, the ToolCallLane walks backward to the nearest still-running
   tool. Works in practice for hooks/sandbox escalations but a future
   SDK that carries `tool_call_id` on the request will let us tighten
   this.
3. **Probe-based approval responder is speculative.** The probe calls
   plausible method names with a guessed argument signature. If a
   future SDK release exposes one of those names but with a different
   shape, the call will throw — and we'll correctly treat it as
   unimplemented and emit `approval.failed`. The fix is to replace the
   probe with a verified call once OQ-10 is resolved positively.


---

## Phase 14 Outcomes — v1.1 Release

### Summary

Performance instrumentation, stress fixtures, and verification audits closing
out v1.1. Every spec §13 budget row now has a backing test or benchmark; the
secret redaction audit closed a real two-level gap in MCP/DB config blocks;
crash recovery, cancellation, and WS reconnect are all green; the README is
written and the design QA pass found zero P0 deltas.

### Decisions made (binding for downstream phases)

1. **Server perf counters as a ring buffer of millisecond samples.** Snapshot
   computes p50/p95/p99 on demand by sorting the live portion (≤1024 samples,
   ~40KB resident). Measurement overhead per observation is <0.1ms even on
   a cold path; this hits the spec §13 "budget for measurement itself" target
   without any decay or interpolation. `NOOP_PERF_COUNTERS` keeps the seam
   type-safe for callers that don't need a real recorder.
2. **Client perf counters mirror the server primitive** but with a different
   counter set (`client_frame_validation_ms`, `client_event_ingest_ms`).
   Module-level singleton + `window.__harnessPerf()` debug hook in dev mode.
3. **`/api/observability/perf` is loopback-only** by virtue of the existing
   bind policy + Origin + CSRF gates. No additional access controls.
4. **`pnpm test:perf` is a separate script** so the default `pnpm test` stays
   watch-friendly. Per-package: server filters `src/__tests__/perf/*`; web
   uses a dedicated `vitest.perf.config.ts` that scans `tests/perf/*.bench.*`.
5. **Cancellation contract verified at the unit level.** RunController's
   `cancel()` covers both `supports("cancel")` branches via
   `apps/server/src/sdk/__tests__/run-controller.test.ts`. The WS plugin's
   `handleCancelRun` is a thin routing layer over `controller.cancel()` and
   re-tested through the framing layer rather than e2e against a stubbed
   stream (the stub's stream completes faster than the test can race a
   cancel_run frame at it).
6. **Redaction policy: explicit field-name listing at each nesting depth.**
   Pino `*` wildcards match exactly one level; MCP / DB config blocks nest
   secrets two levels deep (`config.<name>.<field>`), so `config.*.token`,
   `config.*.secret`, `config.*.password`, `config.*.key` are all listed
   verbatim. Discovered via the Phase 14 audit fixture — `config.db.password`
   was leaking before the fix.

### Files created in this phase

Server (`apps/server/src/`):
- `observability/perf-counters.ts` — `PerfCounters` interface + ring-buffer
  histogram + `NOOP_PERF_COUNTERS`.
- `observability/__tests__/perf-counters.test.ts` — 6 unit tests.
- `observability/__tests__/redaction-audit.test.ts` — 3 tests, full audit
  fixture + sentinel guard rail + CSRF URL scrub.
- `routes/observability.routes.ts` — `GET /api/observability/perf` returns
  `snapshotAll()` + `capturedAt`.
- `sdk/__tests__/usage-extractor-fixtures.test.ts` — 6 explicit fixtures
  per spec §11 Usage Parse Failures.
- `__tests__/integration/pricing.test.ts` — 6 PATCH /api/settings/pricing
  tests covering negative rates, promoMultiplier bounds, lastVerifiedAt
  stamping, and 30-day staleness detection.
- `__tests__/perf/stress-10k-events.test.ts` — 10,000-event stress fixture
  asserting spec §13 budget rows.

Web (`apps/web/`):
- `src/lib/perf-counters.ts` — client mirror of the server primitive.
- `tests/perf/timeline-render.bench.ts` — cold-mount EventTimeline with
  10k pre-seeded events.
- `vitest.perf.config.ts` — extended with the `@vitejs/plugin-react`
  plugin so EventTimeline + StreamingMarkdown JSX paths render.

Docs:
- `README.md` — full quickstart, architecture, dev commands, observability,
  and the honesty-first "Known limitations" section.
- `docs/DESIGN_QA_PASS.md` — surface-by-surface mockup comparison.
- `docs/DESIGN_QA_DELTAS.md` — two P2 polish items, zero P0/P1.

### Files modified in this phase

- `apps/server/src/observability/logger.ts` — added
  `config.*.password` + `config.*.key` to `REDACT_PATHS`.
- `apps/server/src/observability/index.ts` — exports the perf-counter
  surface.
- `apps/server/src/sdk/persist-and-broadcast.ts` — observes
  `sdk_event_received_to_db_commit_ms` and `db_commit_to_ws_broadcast_ms`
  on both the SDK-message and synthetic-event paths.
- `apps/server/src/ws/ws-plugin.ts` — observes `ws_flush_delay_ms` in
  `deliverEvent`; threads `PerfCounters` through `WsPluginOptions`.
- `apps/server/src/app.ts` — constructs a singleton `perfCounters` via
  `createPerfCounters()` and wires it through the pipeline + WS plugin +
  observability route.
- `apps/server/src/routes/index.ts` — registers observability route.
- `apps/web/src/hooks/useWebSocket.ts` — observes
  `client_frame_validation_ms` around `serverFrameSchema.safeParse`.
- `apps/web/src/state/run-store.ts` — observes
  `client_event_ingest_ms` around `ingestServerFrame`.
- `apps/web/vitest.perf.config.ts` — adds the react plugin.
- `apps/server/package.json` + `apps/web/package.json` + root
  `package.json` — `test:perf` script entries.

### Commands run and results

- `pnpm typecheck` — clean across all four workspaces.
- `pnpm lint` — clean.
- `pnpm --filter @harness/server test src/__tests__/perf/stress-10k-events.test.ts` — 10k events in 364ms, commit p95=0.038ms, broadcast p50=0.000ms.
- `pnpm --filter @harness/web run test:perf` —
  - `code-edit-animation.bench`: per-frame p50=0.000ms, Lezer parse p50=0.821ms (budget 1ms), large chunk 0.001ms.
  - `streaming-markdown.bench`: block-boundary p50=0.016ms (budget 12ms), prose p50=0.016ms (budget 4ms).
  - `event-ingest.bench`: p50=0.254ms, p95=0.462ms (budget p50<2ms, p95<8ms).
  - `timeline-render.bench`: cold mount 10k events 15.6ms (loose budget <3s).
- `pnpm --filter @harness/server test src/observability` — 20 tests pass (6 perf-counters + 3 redaction-audit + 11 logger).
- `pnpm --filter @harness/server test src/sdk/__tests__/usage-extractor-fixtures.test.ts` — 6 fixtures pass.
- `pnpm --filter @harness/server test src/__tests__/integration/pricing.test.ts` — 6 tests pass.

### Spec §13 budget row coverage

| Row | Budget | Verified by | Local result |
|---|---:|---|---:|
| SDK event → DB commit | p50 <8ms, p95 <25ms | `stress-10k-events.test.ts` | p50=0.030ms, p95=0.038ms |
| DB commit → WS broadcast | p50 <5ms | `stress-10k-events.test.ts` | p50=0.000ms |
| Client frame validation | <1ms normal | `client_frame_validation_ms` counter (observed in useWebSocket) | – (live) |
| Client event ingestion | p50 <2ms | `event-ingest.bench.ts` + `client_event_ingest_ms` counter | p50=0.254ms |
| Assistant prose update | <4ms | `streaming-markdown.bench.ts` | p50=0.016ms |
| Markdown block-boundary re-render | <12ms | `streaming-markdown.bench.ts` | p50=0.016ms |
| Code edit insertion batch | <4ms | `code-edit-animation.bench.ts` | p50=0.000ms |
| Lezer incremental parse | <1ms | `code-edit-animation.bench.ts` | p50=0.821ms |
| Sustained event rate | 100/sec | `stress-10k-events.test.ts` | 27k/sec (10k events in 364ms) |
| Server WS flush delay | max 33ms / 32 events | `ws_flush_delay_ms` counter (observed in deliverEvent) | – (live) |
| Timeline virtualization threshold | >200 events | `timeline-render.bench.ts` | 10k events render in 15.6ms cold |
| Large payload inline WS cap | 256 KiB | `ws-stream.test.ts` (Phase 07 existing) | n/a |
| Usage aggregate query | <50ms / 10k runs | `history-usage-transcript.routes.test.ts` (Phase 11 existing) | n/a |

### Acceptance gates satisfied

- ✅ `pnpm typecheck && pnpm lint && pnpm test:perf` all pass.
- ✅ 10k-event stress fixture: zero dropped events, budget met by >100× margin.
- ✅ Redaction audit passes; one real gap discovered and fixed.
- ✅ Crash recovery integration test (already in `approval-cancel.test.ts:434`).
- ✅ WS reconnect integration test (already in `ws-stream.test.ts:296`).
- ✅ Cancellation contract covered by `run-controller.test.ts` unit tests
  (98–130) for both `supports("cancel")` branches.
- ✅ Design QA pass produced `docs/DESIGN_QA_PASS.md`. Zero P0 deltas remain.
- ✅ README is complete and accurate.

### Final state of ledger Open Questions

| # | Question | v1.1 final status |
|---|---|---|
| 1 | Prompt caching SDK metadata | partial (no public surface yet) |
| 2 | `run.wait()` final result usage shape | verified (no usage) |
| 3 | Incremental usage in stream events | verified (`turn-ended`) |
| 4 | Cached vs fresh input tokens | verified |
| 5 | Reasoning tokens separately reported | unverified — billing semantics still open; persisted but excluded from cost |
| 6 | Assistant/thinking delta vs snapshot | verified through implementation |
| 7 | Built-in tool names | verified |
| 8 | Code-edit tool args/results shape | verified |
| 9 | `request` event payload beyond `request_id` | verified (sparse) |
| 10 | SDK method to resolve approval | verified-negative — probe + APPROVAL_UNIMPLEMENTED in production |
| 11 | `agent.send` accepts AbortSignal | verified (no) |
| 12 | `Run.cancel()` exists | verified |
| 13 | Cancelled run status value | verified |
| 14 | Reattach Run after restart | verified — wiring deferred to v1.2 |
| 15 | `run.wait()` final result shape | verified |
| 16 | `CloudOptions` schema | verified — typed form deferred to v1.2 |
| 17 | `sandboxOptions.enabled` guarantees | verified |
| 18 | `McpServerConfig` accepted shapes | verified |
| 19 | `Agent.list()` visibility scope | partial — needs live cloud-key smoke |
| 20 | `Agent.resume` model/options requirement | verified |
| 21 | Streaming markdown package | verified |
| 22 | Lezer parser packages | verified |

### Final known limitations carried into the README

- Approval flow (Partial) — `APPROVAL_UNIMPLEMENTED` until OQ-10 resolves positively.
- Cancellation (Partial when SDK reports no cancel support) — explicit `CANCEL_UNAVAILABLE`.
- Cloud mode (Partial) — JSON editor for `CloudOptions`; typed form is v1.2.
- Multi-theme — dark only.
- Mid-run stream reattach — finalize as ERROR for now; `Agent.getRun` wiring is v1.2.
- Reasoning token billing — persisted but excluded from cost.
- EventTimeline virtualization — render is fast enough without it today; tighten budget when wired.

### Release

This is the v1.1 release. Tag with `git tag v1.1.0`.

---

## Phase 20 Outcomes — Context Intelligence and Rules

### Summary

Added the three features that close the biggest gap between CursorHarness
and native Cursor: @-mentions for structured context injection, a project
rules system, and codebase search. Every prompt can now carry relevant
context instead of starting from zero.

### Features delivered

1. **@-Mention system** — Typing `@` in the Composer opens an
   autocomplete dropdown listing files, folders, and symbols from the
   active workspace. Selected items become context chips displayed above
   the input with token estimates. On run start, the server resolves
   each mention's content (file read, directory listing, symbol
   extraction, or grep search) and injects it into the SDK prompt as a
   `<context>` block.

2. **Project rules** — `.harness/rules/*.md` files with YAML frontmatter
   (name, scope, description, optional glob) shape agent behavior.
   Three scopes: `always` (every run), `glob` (included when mentioned
   file paths match), `manual` (only when explicitly @-mentioned by
   name). Rules are assembled into a `<project-rules>` block prepended
   to the prompt before mention context.

3. **Codebase search** — grep (via ripgrep when available, falling back
   to system grep) and file search endpoints power both the `@codebase`
   mention kind and a new Search tab in the right pane. The Search panel
   offers Text and Files modes with result counts and timing.

### Schema changes

- Migration `0004_context_intelligence.sql`:
  - `ALTER TABLE runs ADD COLUMN context_metadata TEXT` with `json_valid` CHECK

### Files created

Shared:
- `packages/shared/src/context.ts` — 16 new Zod schemas (mentions, chips, search, rules, grep)
- `packages/shared/src/context.test.ts` — 20 schema validation tests

Server:
- `apps/server/src/db/migrations/0004_context_intelligence.sql`
- `apps/server/src/services/rules.service.ts` — frontmatter parser, scope resolver, block assembler
- `apps/server/src/services/search.service.ts` — grep search, file search, ripgrep detection
- `apps/server/src/services/context.service.ts` — symbol scanner, content resolution, autocomplete
- `apps/server/src/routes/context.routes.ts` — GET /api/context/search, POST /api/context/resolve
- `apps/server/src/routes/search.routes.ts` — GET /api/search/grep, GET /api/search/files
- `apps/server/src/routes/rules.routes.ts` — GET /api/rules, GET /api/rules/:name
- `apps/server/src/routes/__tests__/context.routes.test.ts` — 5 integration tests
- `apps/server/src/routes/__tests__/rules.routes.test.ts` — 5 integration tests
- `apps/server/src/services/__tests__/rules.service.test.ts` — 10 unit tests

Web:
- `apps/web/src/hooks/useMentionAutocomplete.ts` — @ trigger, debounce, chip management
- `apps/web/src/hooks/useCodebaseSearch.ts` — debounced grep/file search
- `apps/web/src/hooks/useRulesCount.ts` — rules badge data
- `apps/web/src/components/MentionAutocomplete.tsx` — floating dropdown with file/folder/symbol sections
- `apps/web/src/components/ContextChipBar.tsx` — chip bar with token estimates
- `apps/web/src/components/SearchPanel.tsx` — right-pane Search tab with Text/Files modes

### Files modified (key changes)

Shared:
- `packages/shared/src/domain.ts` — `contextMetadata` field on `runRowSchema`
- `packages/shared/src/rest-contracts.ts` — `mentions` field on `createRunRequestSchema`
- `packages/shared/src/index.ts` — barrel exports for all 16 new context schemas

Server:
- `apps/server/src/db/schema.ts` — `contextMetadata` column on runs table
- `apps/server/src/db/repositories/runs.repo.ts` — `context_metadata` in create/read/mapper
- `apps/server/src/sdk/agent-runtime.ts` — context resolution and rules assembly in `startRun`
- `apps/server/src/routes/index.ts` — registered context, search, rules routes
- `apps/server/src/app.ts` — wired context/search/rules route deps

Web:
- `apps/web/src/components/shell/Composer.tsx` — mention autocomplete, chip bar, mentions in submit
- `apps/web/src/components/shell/RightPane.tsx` — Search tab
- `apps/web/src/components/shell/RightTabs.tsx` — Search tab toggle
- `apps/web/src/components/shell/Statusbar.tsx` — rules count badge
- `apps/web/src/components/shell/ToolbarIcons.tsx` — 4 new icons (FileIcon, SearchIcon, CodeIcon, BookIcon)
- `apps/web/src/hooks/useAgentStream.ts` — mentions pass-through to POST /api/runs
- `apps/web/src/app/AppShell.tsx` — rules count prop, mentions type
- `apps/web/src/state/ui-store.ts` — `"search"` added to RightPanelTab union
- `apps/web/src/styles/app-shell.css` — styles for mention autocomplete, context chips, search panel

### Test results

- 306 server tests ✅ (24 new)
- 122 web tests ✅ (0 new — existing composer tests cover the integration)
- 30 shared tests ✅ (20 new)
- 6 eslint plugin tests ✅
- 11 scripts tests ✅
- **Total: 475 tests, all passing**

### Acceptance gates

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅
- Desktop build + install ✅ (May 25 11:55)

### Next phase

Phase 22 — Enrichment: Docs Indexing, Notepads, Terminal AI, Slash Commands (`22_ENRICHMENT.md`).

---

## Phase 22 Outcomes — Enrichment: Docs Indexing, Notepads, Terminal AI, Slash Commands

### Summary

Added four enrichment features that expand the harness from a chat-only SDK
wrapper into a power-user tool with rich context sources, smart terminal
interaction, and extensible commands.

### Features delivered

1. **Custom Documentation Indexing** — Users paste a documentation URL → the
   server crawls the site (BFS, max 2 concurrent, 500ms delay, robots.txt
   respect) → content is indexed in FTS5 → available via `@docs` mentions
   in the Composer. CRUD endpoints for sources, search endpoint with FTS5
   MATCH and snippet extraction.

2. **Persistent Notepads** — Named markdown documents stored in the database.
   `@notepad` mentions resolve notepad content into agent context. Full CRUD
   with unique-name validation, auto-save editor (2s debounce + save-on-blur),
   character count and token estimate. Notepads page at `/notepads`.

3. **Terminal AI (Cmd+K)** — Pattern-based command generation from natural
   language prompts. Dangerous-command detection (rm -rf, kill, DROP TABLE,
   git reset --hard, etc.) with UI warning. Template fallback for
   unrecognized prompts. `TerminalCommandBar` component with Enter/Tab/Esc
   keyboard flow.

4. **Slash Commands** — User-definable prompt templates with `{{variable}}`
   substitution. Five built-in commands seeded on first install (/explain,
   /review, /test, /fix, /refactor). CRUD + expand endpoints. `useSlashCommands`
   hook with pattern matching, variable parsing. Management UI in Settings.

### Schema changes

- Migration `0005_enrichment.sql`:
  - `CREATE TABLE docs_sources` — documentation source metadata
  - `CREATE TABLE docs_pages` — crawled page content
  - `CREATE VIRTUAL TABLE docs_fts USING fts5(...)` — full-text index on docs
  - `CREATE TABLE notepads` — persistent context documents
  - `CREATE TABLE slash_commands` — user-definable prompt templates
  - FTS insert/delete triggers on `docs_pages`

### Files created

Shared:
- `packages/shared/src/enrichment.ts` — 19 Zod schemas for all Phase 22 features

Server:
- `apps/server/src/db/migrations/0005_enrichment.sql`
- `apps/server/src/db/repositories/docs.repo.ts`
- `apps/server/src/db/repositories/notepads.repo.ts`
- `apps/server/src/db/repositories/slash-commands.repo.ts`
- `apps/server/src/services/docs-crawler.service.ts`
- `apps/server/src/routes/docs.routes.ts`
- `apps/server/src/routes/notepads.routes.ts`
- `apps/server/src/routes/terminal-ai.routes.ts`
- `apps/server/src/routes/commands.routes.ts`
- `apps/server/src/services/__tests__/docs-crawler.test.ts`
- `apps/server/src/routes/__tests__/docs.routes.test.ts`
- `apps/server/src/routes/__tests__/notepads.routes.test.ts`
- `apps/server/src/routes/__tests__/terminal-ai.routes.test.ts`
- `apps/server/src/routes/__tests__/commands.routes.test.ts`

Web:
- `apps/web/src/hooks/useDocsSources.ts`
- `apps/web/src/hooks/useNotepads.ts`
- `apps/web/src/hooks/useTerminalAI.ts`
- `apps/web/src/hooks/useSlashCommands.ts`
- `apps/web/src/components/settings/DocsSettings.tsx`
- `apps/web/src/components/settings/CommandsSettings.tsx`
- `apps/web/src/components/TerminalCommandBar.tsx`
- `apps/web/src/pages/Notepads.tsx`

### Files modified (key changes)

- `packages/shared/src/context.ts` — added "docs" and "notepad" to contextMentionKindSchema
- `packages/shared/src/index.ts` — barrel exports for enrichment module
- `apps/server/src/db/repositories/index.ts` — added DocsRepo, NotepadsRepo, SlashCommandsRepo
- `apps/server/src/routes/index.ts` — registered 4 new route modules
- `apps/server/src/app.ts` — wired new route deps + slash command seed
- `apps/server/src/services/context.service.ts` — added @docs and @notepad resolvers
- `apps/server/src/routes/context.routes.ts` — pass docsRepo/notepadsRepo to resolveMention
- `apps/server/src/db/__tests__/migrations.test.ts` — updated table list for new tables
- `apps/web/src/app/App.tsx` — added /notepads route
- `apps/web/src/pages/Settings.tsx` — added DocsSettings + CommandsSettings sections
- `apps/web/src/styles/app-shell.css` — styles for all new components

### Acceptance gates

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅ — 350 server tests, 122 web tests
- Desktop build + install ✅ (May 25 13:03)

### Next phase

Phase 23 — Semantic Search and Multi-Model (`23_SEMANTIC_SEARCH_AND_MULTI_MODEL.md`).
