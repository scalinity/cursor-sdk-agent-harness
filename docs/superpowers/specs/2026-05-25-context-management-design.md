# Context Management & Compaction — Design

**Date:** 2026-05-25
**Status:** Approved direction (pivoted after SDK doc investigation)
**Author:** Claude (goal-driven session)

## Goal

Give the harness real context management: track how full the agent's context window
is, visualize it with a small "fills-up" gauge, surface the model's automatic
compaction, and provide honest long-session controls.

## SDK ground truth (verified — never extrapolate)

| Fact | Source | Verified? |
|---|---|---|
| Per-turn usage `{inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}` via `onDelta(TurnEndedUpdate)` | ledger OQ-03; `usage-extractor.ts` | ✅ |
| `run.wait()` result carries **no** usage | ledger OQ-02 | ✅ |
| **No** context-window size anywhere in SDK types (`ModelListItem`, `ModelSelection`) | `options.d.ts:60-67` | ✅ |
| **No** in-place compaction/summarize method on `SDKAgent`/`Run` | `agent.d.ts`, `run.d.ts` full sweep | ✅ |
| `Run.conversation(): Promise<ConversationTurn[]>` exists (gated by `supports("conversation")`) | `run.d.ts:33` | ✅ |
| **Composer self-summarizes** as a trained behavior when nearing a token trigger (~40k/80k tested); ~1k-token summaries; reuses KV cache | cursor.com/blog/self-summarization | ✅ (doc) |
| SDK runs "the full Cursor harness for context management" → self-summarization happens **inside `agent.send`** | cursor.com/blog/typescript-sdk | ⚠️ documented, not smoke-tested → **OQ-30** |
| Context window ≈ **200,000** tokens, max output ≈ **65,536** (Composer 2.5) | user-confirmed | ⚠️ assumption → **OQ-30** |

### The pivot

Because Composer + the SDK harness **already self-summarize internally** (and the model's
trained summarization beats prompted harness compaction — Cursor's own finding), the harness
must **not** reimplement summarize-and-fork auto-compaction. Doing so would fight the SDK's
KV-cache-reusing trained behavior and produce worse results. The harness's honest role is
**observability + light manual controls**.

## Occupancy math (the one subtlety)

`runs.input_tokens` is the **summed** billing total across all turns
(`accumulateTurnEndedUsage` sums), NOT context occupancy. Current occupancy ≈ the **latest
turn's** per-turn `inputTokens + outputTokens` (what the next turn re-ingests). This *drops*
when Composer self-summarizes mid-run. So RunController must track last-turn usage separately
from the accumulated sum.

```
occupancyTokens ≈ lastTurn.inputTokens + lastTurn.outputTokens
fraction        = occupancyTokens / CONTEXT_WINDOW_TOKENS[modelId]   // clamp [0,1]
usageSource     = "derived" | "unavailable"                          // never estimated
```

## Components

### A. shared — `packages/shared/src/context-budget.ts` (NEW)
- `CONTEXT_WINDOW_TOKENS: Record<ModelId, number>` = `{ "composer-2-5": 200_000, "composer-2-5-fast": 200_000 }` (flagged assumption, OQ-30)
- `MAX_OUTPUT_TOKENS: Record<ModelId, number>` = `{ ...: 65_536 }`
- `SELF_SUMMARY_DROP_RATIO` = `0.4` (a turn whose input < 0.4× the prior turn's occupancy = a self-summary event)
- `contextBudgetSchema` (Zod) → `ContextBudget = { occupancyTokens, windowTokens, fraction, lastTurnInputTokens, lastTurnOutputTokens, usageSource }`
  - ~~`summarizedCount`~~ — scope-cut; self-summary counting deferred to the timeline-marker phase.
- Additive export from `index.ts` (contended file → single additive line only)

### B. server — last-turn capture + persistence
- `RunController`: track `lastTurnUsage` (most recent parsed turn-ended, **not** summed) alongside `accumulatedUsage`.
- Migration `0009_context_occupancy.sql` (additive, renumbered from 0007 to avoid collision with Phase 23's `0007_semantic_search.sql`): `runs.last_turn_input_tokens`, `runs.last_turn_output_tokens` (both nullable INT).
  - ~~`runs.self_summary_count`~~ — scope-cut; client-side detection doesn't need a server column.
- `runs.repo.finalize()`: writes last-turn columns atomically inside the existing transaction; `setUsage` also accepts optional `lastTurn` for the no-final-result branch.
- No new REST route required for v1 — occupancy rides the existing run-summary WS/REST path the web already consumes.

### C. web — the gauge (headline)
- `apps/web/src/components/shell/ContextGauge.tsx` (NEW): presentational SVG ring, `stroke-dasharray` progress, token-colored (`text-tertiary` <50% → `warn` 50-85% → `danger` 85%+), JetBrains Mono tooltip `42.3k / 200k (21%) · Composer 2.5 · estimated`. Zero `useEffect`.
- `apps/web/src/hooks/useContextBudget.ts` (NEW): selector hook deriving `ContextBudget` from the active agent's latest run record in `run-store` + the shared window constant. Pure derivation.
- Integrate into `Statusbar.tsx` (NOT contended) next to existing usage metrics.

### D. web — self-summary detection (timeline marker)
- Compare consecutive runs'/turns' occupancy for the active agent; when a drop ≥ `SELF_SUMMARY_DROP_RATIO` is seen, render a "✦ Composer summarized its context" marker. Client-side derived (replay-safe). v1 may mark at run granularity; intra-run requires per-turn events (deferred).

### E. compaction controls (honest)
- **Auto-summarize = the model's job.** Not reimplemented.
- Threshold nudge banner at ≥ 85% ("context is filling — Composer will self-summarize, or start a fresh session").
- Manual **"Start fresh session"** = create a new agent (existing flow) — the harness-level analogue to Cursor's "start a new conversation" best-practice. Optional `@Past Chats`-style seeding deferred.
- Settings: per-model context-window override (scaffold; defaults from shared constants).

### F. honesty / docs
- Ledger **OQ-30**: does the SDK self-summarize vs error at ~200k? + is 200k the real window? Gated smoke test (`RUN_SDK_SMOKE=true`) pushing context past the limit.
- `IMPLEMENTATION_STATUS.md` updated; clearly mark scaffold-only vs functional.

## Non-goals (YAGNI)
- Reimplementing summarization/compaction (model does it).
- Editing the SDK's `~/.cursor/index.db` conversation store (not possible).
- Local token *estimation* when the SDK gives no usage (`usage_source = "unavailable"`).
- Cross-agent context merging.

## Testing
- shared: constants + schema unit tests.
- server: RunController last-turn tracking (multi-turn → last-turn ≠ sum); finalize writes columns; migration applies.
- web: `useContextBudget` derivation (fraction, clamp, unavailable); `ContextGauge` render snapshot; self-summary drop detection.

## Concurrency note
A parallel bg job is editing `shared/context.ts`, `index.ts`, `ui-store.ts`, `RightPane.tsx`,
`files.routes.ts`. This design avoids those files (new files + additive `index.ts` export only).
