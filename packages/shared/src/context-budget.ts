import { z } from "zod";
import type { ModelId } from "./models.js";

/**
 * Context-window budget model for the harness "context fill" gauge + compaction
 * surfacing.
 *
 * SDK ground truth (verified — see ledger OQ-30):
 *   - The Cursor SDK does NOT expose a context-window size for any model. No
 *     token/limit field exists on `ModelListItem` or `ModelSelection`
 *     (`options.d.ts:60-67`). The numbers below are harness-side ASSUMPTIONS.
 *   - Composer 2.5 is documented/observed at ~200k context with ~65.5k max
 *     output. Flag if wrong — these are overridable in settings and OQ-30
 *     tracks empirical (smoke-test) verification.
 *   - Composer self-summarizes internally as it nears its limit
 *     (cursor.com/blog/self-summarization), so occupancy *drops* mid-session
 *     rather than erroring. The gauge visualizes that; the harness does NOT
 *     reimplement compaction.
 */

/** Assumed total context window per model, in tokens. Flag if wrong (OQ-30). */
export const CONTEXT_WINDOW_TOKENS: Record<ModelId, number> = {
  "composer-2-5": 200_000,
  "composer-2-5-fast": 200_000,
};

/** Assumed max output tokens per model. Informational; not used in gauge math. */
export const MAX_OUTPUT_TOKENS: Record<ModelId, number> = {
  "composer-2-5": 65_536,
  "composer-2-5-fast": 65_536,
};

/** Window used when the run's model is unknown/null. */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;

/**
 * If a turn's occupancy is below this fraction of the previous turn's occupancy,
 * treat it as Composer self-summarization (it condensed ~100k+ tokens to ~1k and
 * continued — cursor.com/blog/self-summarization). Used to mark the timeline.
 */
export const SELF_SUMMARY_DROP_RATIO = 0.4;

/** Occupancy fractions that drive the gauge color + the nudge banner. */
export const CONTEXT_WARN_FRACTION = 0.5;
export const CONTEXT_DANGER_FRACTION = 0.85;

/** Resolve the assumed context window for a model id, with a safe fallback. */
export function contextWindowForModel(modelId: string | null | undefined): number {
  if (!modelId) return DEFAULT_CONTEXT_WINDOW_TOKENS;
  if (modelId in CONTEXT_WINDOW_TOKENS) {
    return CONTEXT_WINDOW_TOKENS[modelId as ModelId];
  }
  return DEFAULT_CONTEXT_WINDOW_TOKENS;
}

export const contextBudgetSchema = z.object({
  /** Current context occupancy estimate = last turn's input + output tokens. */
  occupancyTokens: z.number().int().nonnegative(),
  /** Assumed window for the run's model. */
  windowTokens: z.number().int().positive(),
  /** occupancyTokens / windowTokens, clamped to [0, 1]. */
  fraction: z.number().min(0).max(1),
  lastTurnInputTokens: z.number().int().nonnegative().nullable(),
  lastTurnOutputTokens: z.number().int().nonnegative().nullable(),
  /**
   * "derived" when computed from SDK turn usage; "unavailable" when the SDK
   * delivered no usage. The harness NEVER estimates tokens locally.
   */
  usageSource: z.enum(["derived", "unavailable"]),
});
export type ContextBudget = z.infer<typeof contextBudgetSchema>;

/**
 * Pure derivation of a ContextBudget from the most recent turn's usage.
 *
 * IMPORTANT: this takes the LAST turn's per-turn `inputTokens`/`outputTokens` —
 * NOT the run row's summed billing totals. A run's `input_tokens` is the sum
 * across all turns (`accumulateTurnEndedUsage`), which over a long multi-turn
 * run far exceeds the window. The last turn's `inputTokens` already includes
 * all prior context the model re-ingested, so `lastInput + lastOutput` is the
 * best estimate of how full the window is right now.
 */
export function deriveContextBudget(input: {
  modelId: string | null;
  lastTurnInputTokens: number | null;
  lastTurnOutputTokens: number | null;
}): ContextBudget {
  const windowTokens = contextWindowForModel(input.modelId);
  const hasUsage =
    input.lastTurnInputTokens !== null || input.lastTurnOutputTokens !== null;
  const occupancyTokens =
    (input.lastTurnInputTokens ?? 0) + (input.lastTurnOutputTokens ?? 0);
  const fraction = Math.min(Math.max(occupancyTokens / windowTokens, 0), 1);
  return {
    occupancyTokens,
    windowTokens,
    fraction: hasUsage ? fraction : 0,
    lastTurnInputTokens: input.lastTurnInputTokens,
    lastTurnOutputTokens: input.lastTurnOutputTokens,
    usageSource: hasUsage ? "derived" : "unavailable",
  };
}

/**
 * @internal Scaffold — exported and tested but not yet consumed. The timeline
 * marker that would call this is deferred to a future phase.
 *
 * True when `current` occupancy dropped far enough below `previous` to be
 * Composer self-summarization rather than a normal turn. Both args are
 * occupancy-token estimates (last-turn input + output). Returns false when
 * either side is missing or `previous` is too small to judge.
 */
export function isSelfSummaryDrop(
  previousOccupancy: number | null,
  currentOccupancy: number | null,
): boolean {
  if (
    previousOccupancy === null ||
    currentOccupancy === null ||
    previousOccupancy <= 0
  ) {
    return false;
  }
  return currentOccupancy / previousOccupancy < SELF_SUMMARY_DROP_RATIO;
}
