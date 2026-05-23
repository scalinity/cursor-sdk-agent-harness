# Phase 15 — Post-Build Review

Living failure ledger for the post-build remediation pass. Findings are
recorded as they are surfaced, fixed, and verified.

## Summary

State of the app at session start:

- Phase 0 baselines (`pnpm install/typecheck/lint/test/build/migrate`) all
  pass on first try.
- `pnpm dev` starts the Fastify server on `127.0.0.1:4783` and Vite on
  `127.0.0.1:5173` cleanly (after killing one stale dev process from a
  prior session that was squatting port 5173).
- REST endpoints (`/api/security/csrf-token`, `/api/settings`,
  `/api/agents`, `/api/runs`) all respond 200 with valid payloads when
  the dev `Origin` header is present.
- The web bundle, however, crashed on first render with a
  `getSnapshot should be cached` warning followed by "Maximum update
  depth exceeded". Page snapshot was empty (0 bytes) — confirming the
  blank-screen symptom the prompt warned about.
- A secondary failure: a CSRF-token cold-start race tore down and
  reconnected the WS once per concurrent `useCsrfToken` consumer, of
  which there are 8 — visible as 8 `WebSocket connection failed`
  warnings on first load.
- Driving the chat flow surfaced four more independent root causes:
  CURSOR_API_KEY env var never landed in the Keychain on first boot,
  the harness's model IDs didn't match the SDK's enum, the normalizer
  mis-encoded per-message text deltas as snapshot-replacements, and
  the streaming-text channel buffer was wiped by React StrictMode's
  double-mount cycle.

Severity distribution (final):

- P0: 6 found, 6 verified (F-001 through F-006)
- P1: 0
- P2: 0
- Blocked / needs user: 0

---

## P0 — Blocks core flow

### F-001: AppShell crashes on mount with "Maximum update depth exceeded"

- **Symptom**: Page renders blank. React DevTools reports
  `getSnapshot should be cached to avoid an infinite loop` followed by
  `Maximum update depth exceeded`. Playwright snapshot YAML is 0 bytes.
- **Scenario**: A (initial load on `/`).
- **Phase of origin**: 08.
- **Root cause**: Three Zustand `useRunStore` selectors returned a fresh
  `?? []` literal on each call:
  - `apps/web/src/components/shell/RightPane.tsx:13` (both branches)
  - `apps/web/src/components/streaming/ToolCallCard.tsx:98`
  - `apps/web/src/hooks/useRunReplay.ts:76`
  Zustand uses `Object.is` for snapshot equality → infinite loop.
- **Fix**: Module-level `EMPTY_EVENTS: CanonicalRunEvent[]` constant in
  each file, returned from every branch. Mirrors the working pattern in
  `CodeEditPreviewPanel.tsx:17`.
- **Commit**: 4393bbd
- **Verification**: Re-navigated `/` in Playwright. 3-pane shell
  renders fully, zero console errors.

### F-002: CSRF cold-start race tore down WS once per consumer

- **Symptom**: Eight `WebSocket connection failed` warnings on first
  load; ~20+ `/api/security/csrf-token` server fetches in rapid
  succession.
- **Scenario**: A + P.
- **Phase of origin**: 08.
- **Root cause**: `useCsrfToken` is called from 8 places. Each instance
  held its own `inFlightRef`, so dedupe was per-instance. With
  StrictMode the 8 instances became 16 simultaneous fetches, each
  writing a new token to `ui-store.csrfToken` and triggering a WS
  teardown/reconnect.
- **Fix**: Hoisted the in-flight promise to module scope so all
  instances share one cold-start fetch.
- **Commit**: bd7c131
- **Verification**: One csrf-token fetch on cold load, WS stable at
  `open`, zero console errors/warnings.

### F-003: CURSOR_API_KEY env var never reached the Keychain

- **Symptom**: `GET /api/settings/api-key` returned `{present: false}`
  even when `.env` contained a valid key. Every agent run subsequently
  failed at the SDK boundary.
- **Scenario**: D (create agent + send prompt).
- **Phase of origin**: 02 / 05 (the dev orchestrator + Keychain
  bootstrap, working in isolation but not when wired together).
- **Root cause**: `apps/server/src/index.ts` imports `dotenv/config`,
  which reads `.env` from `process.cwd()`. pnpm scopes the server
  script to `apps/server/` where no `.env` exists; the repo-root `.env`
  was never loaded. The "Imported CURSOR_API_KEY into macOS Keychain"
  log line never fired because `env.CURSOR_API_KEY` was always
  undefined.
- **Fix**: Pre-load the repo-root `.env` in `scripts/dev.mjs` so the
  vars propagate to both child processes via `spawn`'s
  `env: process.env`. Self-contained parser — no new runtime dep.
- **Commit**: 63dc82c
- **Verification**: After restart, server log shows "Imported
  CURSOR_API_KEY into macOS Keychain"; `GET /api/settings/api-key`
  reports `{present: true}`.

### F-004: harness model IDs don't match `@cursor/sdk@1.0.13` enum

- **Symptom**: Every POST `/api/runs` returned
  `SDK_SEND_FAILED: Cannot use this model: composer-2-5-fast`. SDK
  enumerated valid models: `default, composer-2.5, composer-2, …` —
  the harness's two IDs aren't in the list.
- **Scenario**: E (submit prompt).
- **Phase of origin**: 04 (schema choice) and 06 (no translation
  layer).
- **Root cause**: `modelIdSchema` uses `composer-2-5-fast` and
  `composer-2-5` (the harness's fast-vs-standard pricing distinction).
  `agent-options-builder.ts` passed these literally to the SDK.
- **Fix**: `HARNESS_TO_SDK_MODEL_ID` map at the SDK boundary
  (`composer-2-5-fast → composer-2.5`, `composer-2-5 → composer-2`),
  applied to both the top-level agent model and subagent overrides.
  Harness schema, pricing keys, and settings rows stay unchanged so the
  fast-vs-standard pricing distinction survives.
- **Commit**: 8f6d473
- **Verification**: Real SDK run completed end-to-end: prompt → 4
  events (status RUNNING, two assistant deltas, status FINISHED) →
  `usageSource: "sdk_final_result"` with 16k input / 27 output tokens.

### F-005: assistant text normalizer drops earlier deltas

- **Symptom**: Assistant text rendered "LO" instead of "HELLO" (or
  "COUNT ONE TWO THREE" rendered as just "COUNT" after one delta etc.).
  DB events showed `text_delta: "LO"` with `is_replacement: true` and
  `full_text_length: 2` for what should have been a cumulative
  "HELLO".
- **Scenario**: E (timeline render of streamed reply).
- **Phase of origin**: 07 (normalizer). OQ-06 was marked partial /
  "Phase 09 confirms" — never confirmed; the assumption was wrong.
- **Root cause**: `deriveTextMode` assumed the SDK might send cumulative
  snapshots. When the next message's text didn't prefix the previous,
  it emitted a snapshot-replacement (`is_replacement: true`) and the
  caller wrote `fullText` back as the new buffer — truncating earlier
  text. `@cursor/sdk@1.0.13` actually sends per-message deltas where
  each `message.content[].text` is the new chunk.
- **Fix**: Add a `newBufferText` field to `DerivedTextMode`. On the
  non-prefix branch, treat the input as an append-delta: emit
  `text_delta: current` with `is_replacement: false`, merged buffer
  `previous + current`. Callers write `newBufferText` to the buffer
  instead of `fullText`. Two normalizer tests that asserted the snapshot
  path are updated to the append semantics.
- **Commit**: 3005eb4
- **Verification**: New run "COUNT ONE TWO THREE" stored in DB as two
  deltas with `is_replacement: false`; the next finding (F-006) was
  needed before the UI also showed the full text.

### F-006: streaming-text channel buffer wiped by StrictMode

- **Symptom**: Even after F-005, the UI rendered only the first delta
  of every run ("STREAM" instead of "STREAMING WORKS"). The run-store
  had the correct cumulative `assistantText`; the DOM didn't.
- **Scenario**: E + G (live + replay assistant rendering).
- **Phase of origin**: 09 (streaming surfaces).
- **Root cause**: Two interacting bugs in `useStreamingMarkdown` and
  the streaming-text channel.
  1. The structural-publish path in `useStreamingMarkdown` was
     RAF-deferred. The RAF callback closed over a stale `nextBlocks`
     snapshot. If a non-structural `applyText` ran first (the second
     delta), it published the latest text synchronously; the deferred
     RAF then overwrote the channel buffer with the older captured
     snapshot. Last-write-wins, but ordering was wrong.
  2. `streaming-text-channel.subscribeStreamingText` deleted the
     buffered update when its listener-set went empty. React StrictMode
     dev runs every effect's cleanup before re-running the effect, so
     the buffer was wiped between the first mount and the second
     remount — late subscribers (the actual paint) saw nothing.
- **Fix**:
  - Publish structurally in the same tick as the write (no RAF defer);
    cleans up the now-dead `rafIdsRef`.
  - Keep the channel's latest-update entry around until a new publish
    overwrites it. Buffer survives the StrictMode dance.
- **Commit**: b4d9ab4
- **Verification**: Re-navigated to the "STREAMING WORKS" replay: DOM
  shows full "STREAMING WORKS". Fresh live run "COUNT ONE TWO THREE"
  also rendered in full.

---

## P1 / P2

None surfaced beyond what F-001..F-006 covered.

---

## Out-of-scope observations (filed, not fixed)

- `/api/health/version` reports `phase: "02-monorepo-bootstrap"` long
  after the codebase has advanced to Phase 14. Cosmetic.
- `/api/agents` shows `ERR_ABORTED` twice in network log — benign
  StrictMode dev double-mount cleanup behavior.
- The harness's two-tier `composer-2-5-fast` / `composer-2-5` model
  schema is a pricing-only distinction that doesn't exist in the SDK.
  Translating at the boundary (F-004) keeps the existing pricing rows
  working; when the SDK schema stabilises, collapse the harness
  schema to match.
- The agent default `sandboxEnabledByDefault: true` makes the smoke
  loop fail on machines without `~/.cursor/sandbox.json` — the
  error message is honest (`Local SDK sandboxing was requested, but
  sandboxing is not supported in this environment`). Either change the
  default to `false` (less safe) or document the requirement. Logged as
  follow-up.
