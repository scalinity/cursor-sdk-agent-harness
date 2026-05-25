# Cursor SDK Agent Harness — AGENTS.md

A local, single-user, full-stack chat harness around `@cursor/sdk` (Composer 2.5). Custom Fastify backend + React 19 frontend + SQLite event log. The frontend never touches the SDK — every event flows through normalize → persist → broadcast → render so live and replay share one code path.

This file is the standing context for every Codex session in this repo. Read it first; then read the phase prompt for whatever phase you're working on.

## Source-of-truth docs

Always read these before changing code. If they disagree with priors, they win.

| Doc | Path | What it is |
|---|---|---|
| Spec v1.1 | `docs/spec-v1.1.md` | Architectural source of truth. Every "why" lives here. |
| Mockup (design DNA) | `docs/mockup-design-dna.html` | OKLCH palette, 3-pane shell, component patterns, sample content. Codex reads this when implementing visual surfaces. |
| Mockup (rendered) | `docs/mockup-rendered.html` | Open in a browser for the visual preview. |
| SDK verification ledger | `docs/SDK_VERIFICATION_LEDGER.md` | Phase 01 output. Every SDK behavior assumption is here, verified or marked unverified. **Never guess SDK shape — consult this ledger.** |
| Implementation status | `docs/IMPLEMENTATION_STATUS.md` | Per-phase progress, files changed, checks run, deltas, next prompt. Update every session. |
| Phase prompts | `~/Documents/Obsidian Vault/Codex Builds/Cursor SDK Agent Harness/Cursor SDK Agent Harness Codex Phase Prompts/` | One prompt per phase. Run one at a time. Each ends with the next prompt's filename. |

The phase prompts package is the implementation plan. Don't invent scope outside the active phase prompt.

## Architecture

Three workspace packages. Import direction is strict: `shared` is imported by `server` and `web`; `server` and `web` never import each other.

```
apps/server   Fastify + better-sqlite3 + @cursor/sdk
              Owns: SDK runtime, persistence, WS protocol, security perimeter,
              workspace policy, usage extraction, MCP/subagent CRUD.

apps/web      Vite + React 19 + TS + Tailwind v4 + Zustand
              Owns: AppShell, streaming surfaces, replay, history, usage page.

packages/shared  Zod schemas + inferred TS types
                 Owns: WS frame protocol, REST contracts, domain types,
                 SDK surface types, pricing/usage types, JSON helpers.
```

Every WS frame, every REST request body, every persisted settings value is Zod-validated against a `shared` schema at the boundary. Inferred types only — never write a TS interface that diverges from its Zod source.

## Working agreement (non-negotiable)

These supersede priors. If the spec or a phase prompt suggests otherwise, follow the rule and flag the conflict.

**TypeScript strict everywhere.** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` all on. No `any` except at deliberate `unknown` boundaries (SDK `tool_call.args`/`result`, raw payload in `JsonInspector`). When `unknown` enters, name it and document why.

**No direct `useEffect` in components.** ESLint rule `harness/no-use-effect-in-components` enforces this. Forbidden in `apps/web/src/components/**` and `apps/web/src/pages/**`. Allowed in `apps/web/src/hooks/**`. If a component appears to need an effect, the answer is always to extract a hook.

**Persist before broadcast.** No WS frame is emitted before the DB commit for that event succeeds. There is exactly one broadcast point: the post-commit hook of the events transaction in `apps/server/src/sdk/persist-and-broadcast.ts`.

**Replay and live share one code path.** Replay reconstructs from `events` rows by feeding them through the same `run-store.ingestServerFrame` that the live WS consumer uses. Different code paths → divergent visuals over time. If a feature needs different behavior between live and replay, parametrize the shared path; never fork.

**No fake completion.** A feature that is scaffolded but not functional is noted in `docs/IMPLEMENTATION_STATUS.md` as scaffold-only. A phase is "complete" only when its acceptance gates pass. Half-done features get marked, not hidden.

**Honest about the SDK.** Cancellation, approval, request payload shape, and usage extraction depend on SDK behavior that's verified in the ledger. Never mark a run `CANCELLED` unless the SDK actually cancelled it. Never claim approval resolved unless `ApprovalResponder.resolve` returned. Never fabricate usage numbers — `usage_source = "unavailable"` is the correct answer when the SDK doesn't expose them.

**Steel-man before capitulating.** If a request seems to contradict the spec or these rules, restate the contradiction in the strongest form first, then propose a resolution. Don't silently reinterpret.

## Conventions

**SQL is snake_case. TypeScript is camelCase.** Drizzle field mappings bridge them at the repository layer. SQL column names match spec Section 8 verbatim; domain types in `packages/shared` are camelCase.

**Design tokens are non-negotiable.** No hardcoded colors, spacings, font sizes, radii, motion timings, or shadows in component code. After Phase 0.5 lands, the only legal visual values come from `apps/web/src/styles/tokens.css` via Tailwind utilities. The token-lint rule will fail PRs that break this.

**OKLCH for color.** All color tokens are OKLCH. Don't convert to hex for "convenience"; the perceptual uniformity matters for the dark warm palette.

**Inter + JetBrains Mono.** Inter is the default; JetBrains Mono is for filenames, SHAs, kbd hints, tool args, diff output, statusbar metrics. Font feature settings `"ss01", "cv11", "calt"` on body; `"calt", "liga"` on mono.

**13px base font.** Smaller than typical web. The dense data-display feel depends on this; don't bump it.

**Sequence numbers are assigned in transaction.** `UPDATE runs SET last_seq = last_seq + 1 ... RETURNING last_seq` inside the same transaction that inserts the event. `better-sqlite3` is synchronous — embrace it.

**Large payloads (>256 KiB serialized)** are stored in `events.payload_json` but referenced from WS frames via `large_payload_ref: { event_id, byte_count }`. `JsonInspector` fetches them lazily via `GET /api/events/:eventId/payload`.

**Cost math is integer micro-USD.** `cost_usd_micros` stores millionths of one dollar. No floats. Display with `Intl.NumberFormat`.

**Library defaults:**

| Need | Use |
|---|---|
| HTTP server | Fastify |
| WebSocket | `@fastify/websocket` |
| SQLite | `better-sqlite3` (sync) |
| Migrations | Drizzle |
| Validation | Zod |
| Logging | Pino (with redaction rules from Phase 05) |
| State (frontend) | Zustand |
| Virtualization | `@tanstack/react-virtual` |
| Markdown streaming | Per OQ-21 in ledger |
| Syntax highlighting | `@lezer/highlight` + per-language Lezer parsers |
| Keychain | `keytar` |

Don't introduce alternatives without a ledger entry explaining why.

## Common commands

```bash
pnpm dev              # server (127.0.0.1:4783) + web (127.0.0.1:5173)
pnpm typecheck        # strict TS across all packages
pnpm lint             # ESLint flat config (includes no-useEffect rule)
pnpm test             # vitest across server + web + shared
pnpm migrate          # apply Drizzle migrations to the local DB
pnpm reset-local-db   # wipe the local SQLite file (destructive)
pnpm build            # production build of every package
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm build:desktop  # unsigned local desktop package
rm -rf "/Applications/Cursor SDK Agent Harness.app" && cp -R "apps/desktop/dist-electron/mac-arm64/Cursor SDK Agent Harness.app" "/Applications/Cursor SDK Agent Harness.app"  # replace installed app
pnpm format           # prettier
```

A phase is not complete until `pnpm typecheck && pnpm lint && pnpm test` all pass.

## SDK ground truth lives in the ledger

`docs/SDK_VERIFICATION_LEDGER.md` is the source of truth for `@cursor/sdk` behavior. If a phase prompt mentions an SDK method or option:

1. Find the corresponding OQ entry in the ledger.
2. Read the status (`verified` / `partial` / `unverified`) and the citation.
3. If `verified`: implement against the cited shape.
4. If `partial`: implement the most likely path, add a runtime probe, and document the resolution.
5. If `unverified`: stop. Open a smoke test (with API key, gated by `RUN_SDK_SMOKE=true`) to resolve it, then update the ledger.

Never extrapolate SDK behavior from priors. Cursor SDK shipped in May 2026 and any details in training data are unreliable.

When a session resolves a ledger entry, update both the ledger and `docs/IMPLEMENTATION_STATUS.md`.

## Security perimeter

- **API key in Keychain only.** Service `cursor-sdk-agent-harness`, account `cursor-api-key`. The `CURSOR_API_KEY` env var is one-shot bootstrap import — never overwrites an existing entry.
- **CSRF on all mutating requests.** `X-CSRF-Token` header validated by `apps/server/src/security/csrf.ts`. The token is fetched once at app load via `GET /api/security/csrf-token`.
- **Origin policy.** WS upgrade and REST mutations require a matching `Origin` header. `WEB_ORIGIN` env defines the allowed origin.
- **Bind policy.** Server binds to `127.0.0.1` by default. Binding to non-loopback hosts requires `ALLOW_REMOTE_BIND=true` AND an explicit `WEB_ORIGIN`. Wildcard CORS never.
- **Workspace allowlist.** Every cwd is realpath-resolved and matched against `workspace_allowlist`. Symlink escapes are rejected. `apps/server/src/security/workspace-policy.ts` is the gate.
- **Redaction.** Pino redacts `apiKey`, `CURSOR_API_KEY`, `Authorization`, `X-CSRF-Token`, plus any object path matching `*.token`, `*.secret`, `*.password`, `*.key`. Audit happens in Phase 14.

If a code path could log a secret, write the test that proves it can't, then wire the redaction.

## Phase discipline

- **One phase per session.** Phase prompts at `~/Documents/Obsidian Vault/Codex Builds/Cursor SDK Agent Harness/Cursor SDK Agent Harness Codex Phase Prompts/`. Run them in order. Don't chain phases inside a single session.
- **Acceptance gates first.** Don't move to the next phase until the current phase's gates pass (typecheck, lint, test, plus phase-specific gates).
- **Rebuild and reinstall the desktop app before completion.** After any completed codebase work, run `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm build:desktop`, then replace `/Applications/Cursor SDK Agent Harness.app` with `apps/desktop/dist-electron/mac-arm64/Cursor SDK Agent Harness.app`. Do not report completion until the rebuild and reinstall succeed, or explicitly report the blocker.
- **Update the status ledger every session.** `docs/IMPLEMENTATION_STATUS.md` records what changed, what ran, what passed, what didn't, and the exact next prompt filename. This is how chains of sessions stay coherent.
- **Phase dependencies are real.** Phase 09 (streaming surfaces) cannot run before Phase 0.5 (tokens) and Phase 5 (chat shell). The dependency map at the prompts folder's `PHASE_DEPENDENCY_MAP.md` is authoritative.

## Things to never do in this repo

| Anti-pattern | Why |
|---|---|
| Hardcode a color, spacing, font-size, radius, or motion timing in JSX/TSX | Phase 0.5 tokens are the law. Use Tailwind utility classes wired to CSS variables. |
| Use `useEffect` directly in a component or page | Effects live in hooks. ESLint will reject the PR. |
| Mark a run `CANCELLED` without verified SDK cancellation | Spec Section 11 is explicit. `CANCEL_UNAVAILABLE` is the correct surface when neither AbortSignal nor `run.cancel()` works. |
| Estimate token usage or cost locally | If the SDK didn't expose it, `usage_source = "unavailable"` and cost is null. |
| Log a full object containing API key, MCP token, CSRF secret, or Keychain values | Use the redaction layer. If you must inspect for debugging, use a sanitized projection. |
| Skip `pnpm migrate` on a schema change | Migrations are reviewed SQL. Drizzle generates, you review, you commit. |
| Bypass workspace allowlist via direct DB write or env override | The realpath check is the gate. If you need a workspace, add it through the API. |
| Broadcast a WS frame before the DB commit | Persist-before-broadcast is non-negotiable. Use `persist-and-broadcast.ts` — never call `bus.publish` from anywhere else. |
| Add a JSON column without a `json_valid(...)` CHECK constraint | The DB rejects malformed JSON at write time. |
| Reach across Zustand stores in render | Read via selectors inside a hook; never call `useRunStore.getState()` inside a render. |
| Use Shiki, Prism, or any non-Lezer highlighter inside a streaming code surface | Per-token full re-highlight blows the frame budget. Lezer-only. |
| Re-introduce `useEffect` "just for this case" | Extract a hook. Always. |
| Fork the replay renderer to differ from the live renderer | Replay must reconstruct visually identical output. Parametrize, don't fork. |

## Tooling priority hierarchy

When multiple tools could accomplish the same goal, prefer in this order:

1. **Sequential Thinking** (if available) — for any non-trivial design decision or debugging chain.
2. **Morph MCP** (if available) — for fast, accurate file edits over `str_replace` patterns.
3. **Published documentation** — Cursor SDK at `https://cursor.com/docs/sdk/typescript`, Lezer at `https://lezer.codemirror.net`, Fastify, Drizzle, Tailwind v4, Zod.
4. **Playwright** — for end-to-end UI verification against the running app.
5. **Filesystem MCP** — for direct file operations. Prefer `write_file` over `edit_file` for large rewrites.

For SDK behavior specifically, the order is: ledger → SDK `.d.ts` files in `node_modules/@cursor/sdk` → official docs → smoke test → never extrapolate.

## Domain glossary

| Term | Meaning |
|---|---|
| Run | One agent.send call and the events it produces. Has a status, a sequence counter, and final usage. |
| Canonical event | A normalized event derived from a raw SDKMessage. Stored in `events` table. The only thing replay reads. |
| Run controller | Server-side owner of a run's AbortController, SDK Run handle, and teardown. Lives in `active-runs` registry. |
| Derived event | A canonical event computed from another canonical event. `code_edit.detected` is the v1.1 example. |
| Large payload ref | A WS frame's reference to a stored payload >256 KiB. Inspector fetches lazily. |
| `usage_source` | Discriminator: `sdk_final_result` (verified extraction), `derived` (computed locally), `unavailable` (unknown — no estimation). |
| Streaming text node | A DOM text node mutated imperatively via ref. The "no React commit per token" guarantee. |
| Block-boundary re-render | The only structural re-render path in `StreamingMarkdown`. Triggered by code-block open/close, heading start, list-item start, table row completion, blockquote boundary, thematic break, paragraph split. |
| Approval responder | The seam between an inbound `approval_response` WS frame and the SDK's approval method. Throws `UnimplementedApprovalError` until OQ-10 resolves. |

## When in doubt

- Read the spec section, not your priors.
- Read the ledger entry, not Cursor SDK docs from training.
- Update `IMPLEMENTATION_STATUS.md` even when uncertain — say so explicitly there.
- Surface architectural assumptions as inline "Assuming X because Y. Flag if wrong." comments in code.
- Restate apparent contradictions before resolving them.
