import {
  type PricingSettings,
  type SettingsSnapshot,
  type TokenUsage,
} from "@harness/shared";
import { z } from "zod";

/**
 * The SDK delivers final per-run usage through `onDelta(TurnEndedUpdate)` — NOT
 * through `run.wait()`'s `RunResult`. See OQ-02 / OQ-03 in the verification
 * ledger. This extractor takes the accumulated turn-ended usage snapshot
 * (which the RunController collects across all `turn-ended` events for the
 * run) plus the harness's pricing settings, and produces the typed
 * `RunUsage` shape that lives on the `runs` row.
 *
 * `usage_source` semantics:
 *   - `"sdk_final_result"`: a turn-ended event yielded a usage object whose
 *     shape we recognise. (The literal stays for backward compat with the spec;
 *     its meaning is the LAST turn-ended event, not `run.wait()`.)
 *   - `"unavailable"`: no usage was ever observed, OR the shape did not match
 *     and `strict: true` left us nothing to record. The harness NEVER estimates.
 *   - `"derived"`: reserved for future harness-side derivation (not used in v1).
 */

// P14-W1: `.strict()` so safeParse rejects payloads whose entire key
// set falls outside the canonical names. Without strict, Zod's default
// behavior is to strip unknown keys silently, leaving `{}` and a
// success result — which routed unknown-shape payloads through the
// "parseable but all token fields missing" branch instead of the
// safeParse-failure branch. Strict makes those two failure modes
// distinguishable to the `parseError.message` field.
const turnEndedUsageShape = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  // Reasoning tokens — see OQ-05; not part of the documented public shape but
  // we accept either alias if a future SDK version exposes it.
  reasoningTokens: z.number().int().nonnegative().optional(),
  reasoning_tokens: z.number().int().nonnegative().optional(),
}).strict();
export type ParsedTurnEndedUsage = z.infer<typeof turnEndedUsageShape>;

export interface ExtractedUsageInput {
  /**
   * Snapshot of the `usage` field from the LAST `turn-ended` delta event
   * received for the run. If multiple turn-ended events fired during the run,
   * the caller should pass the latest one — the SDK semantic is that each
   * turn-ended event reports per-turn cumulative usage; the harness sums
   * across turns explicitly via `accumulateTurnEndedUsage`.
   */
  rawUsage: unknown;
  modelId: string;
  pricing: SettingsSnapshot["pricing"];
}

export interface ExtractedUsage extends TokenUsage {
  parseError?: { message: string; rawShape: unknown };
}

export function extractUsage(input: ExtractedUsageInput): ExtractedUsage {
  if (input.rawUsage === null || input.rawUsage === undefined) {
    return unavailable();
  }
  // Fast path: `rawUsage` is already a `ParsedTurnEndedUsage` produced by
  // `accumulateTurnEndedUsage` (which validated each turn at accumulation
  // time). Re-parsing here would just allocate Zod issue arrays for no
  // gain. We do a defensive shape check: if it doesn't look parsed,
  // fall back to the safeParse path so callers handing us raw SDK shapes
  // still work.
  const usage: ParsedTurnEndedUsage | null = looksParsed(input.rawUsage)
    ? (input.rawUsage as ParsedTurnEndedUsage)
    : (() => {
        const parsed = turnEndedUsageShape.safeParse(input.rawUsage);
        return parsed.success ? parsed.data : null;
      })();
  if (usage === null) {
    // Shape didn't match either pre-parsed accumulator OR raw turn-ended
    // payload — capture a redacted shape so ops can diagnose SDK drift.
    return {
      ...unavailable(),
      parseError: {
        message: "Usage payload did not match TurnEndedUpdate.usage shape",
        rawShape: shapeOf(input.rawUsage),
      },
    };
  }
  const inputTokens = usage.inputTokens ?? null;
  const outputTokens = usage.outputTokens ?? null;
  const cachedInputTokens = usage.cacheReadTokens ?? null;
  // Treat reasoningTokens as null until OQ-05 resolves. We persist whatever
  // the SDK exposed for future analytics, but billing math excludes it.
  const reasoningTokens = usage.reasoningTokens ?? usage.reasoning_tokens ?? null;

  if (inputTokens === null && outputTokens === null && cachedInputTokens === null) {
    // Shape parsed but every token field was missing — distinct from "no
    // usage observed." Preserve a hint so ops can tell the difference
    // (e.g. SDK emitted `{}` vs SDK never emitted turn-ended).
    return {
      ...unavailable(),
      parseError: {
        message: "TurnEndedUpdate.usage was parseable but every token field was missing",
        rawShape: shapeOf(input.rawUsage),
      },
    };
  }

  const costUsdMicros = computeCostMicros({
    inputTokens,
    outputTokens,
    cachedInputTokens,
    modelId: input.modelId,
    pricing: input.pricing,
  });

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: cachedInputTokens,
    reasoning_tokens: reasoningTokens,
    cost_usd_micros: costUsdMicros,
    usage_source: "sdk_final_result",
  };
}

const CANONICAL_USAGE_KEYS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "reasoning_tokens",
] as const;

/**
 * Cheap structural test: does `value` already look like a
 * `ParsedTurnEndedUsage` snapshot? If yes we skip the Zod re-parse on the
 * happy path (see `extractUsage`). False negatives are safe — we fall
 * back to safeParse — but a true positive saves the issue-array
 * allocation per call.
 *
 * P14-W1: require at least one canonical key to be present. The
 * previous implementation returned `true` for objects with zero
 * canonical-key overlap (e.g. `{ totalTokens, billing_unit }`), which
 * silently routed unknown-shape payloads down the "parseable but all
 * token fields missing" branch instead of the safeParse-failure branch.
 * Both branches yielded `usage_source: "unavailable"` so behavior was
 * indistinguishable to current callers, but the `parseError.message`
 * field diverged — and a future consumer that branches on it would get
 * the wrong path. Now: must have at least one canonical key AND every
 * present canonical key must be a number.
 */
function looksParsed(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  let sawCanonical = false;
  for (const k of CANONICAL_USAGE_KEYS) {
    if (k in v) {
      if (typeof v[k] !== "number") return false;
      sawCanonical = true;
    }
  }
  return sawCanonical;
}

function unavailable(): TokenUsage {
  return {
    input_tokens: null,
    output_tokens: null,
    cached_input_tokens: null,
    reasoning_tokens: null,
    cost_usd_micros: null,
    usage_source: "unavailable",
  };
}

/**
 * Best-effort describer for an unknown usage shape so we can persist it in
 * the run row for later diagnosis without leaking secrets. Strings get
 * type-only, numbers/booleans/null get the value, arrays/objects get
 * recursive key descriptions.
 */
function shapeOf(value: unknown, depth = 0): unknown {
  if (depth > 3) return "<truncated>";
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 4).map((v) => shapeOf(v, depth + 1));
  }
  switch (typeof value) {
    case "string":
      return "<string>";
    case "number":
      return "<number>";
    case "boolean":
      return "<boolean>";
    case "undefined":
      return undefined;
    case "object": {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(value as object).slice(0, 16)) {
        out[k] = shapeOf((value as Record<string, unknown>)[k], depth + 1);
      }
      return out;
    }
    default:
      return `<${typeof value}>`;
  }
}

interface CostInputs {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  modelId: string;
  pricing: SettingsSnapshot["pricing"];
}

/**
 * Cost formula (spec §4 → Usage and Cost Extraction Policy):
 *
 *   freshInputTokens = max(inputTokens - cachedInputTokens, 0)
 *   baseMicros = (freshInputTokens * inputRate
 *               + cachedInputTokens * cachedRate
 *               + outputTokens     * outputRate) / 1_000_000
 *   costMicros = round(baseMicros * promoMultiplier)
 *
 * Returns null when pricing for the model is unknown (we never invent
 * numbers — spec §11 Usage Parse Failures → "Pricing values are missing or
 * zero → cost_usd_micros = NULL").
 */
function computeCostMicros(input: CostInputs): number | null {
  const rates = pricingForModel(input.modelId, input.pricing);
  if (rates === null) return null;
  if (input.inputTokens === null || input.outputTokens === null || input.cachedInputTokens === null) {
    return null;
  }
  const inputTokens = input.inputTokens;
  const outputTokens = input.outputTokens;
  // Clamp cachedInputTokens to inputTokens. The SDK occasionally reports
  // cumulative cache reads larger than the prompt's input tokens (e.g.
  // when the cached prefix is larger than the just-sent message). Before
  // clamping, `Math.max(inputTokens - cachedInputTokens, 0)` zeroed
  // fresh-input but still charged for the full reported cached count —
  // asymmetric. Clamp first so cached ≤ input always holds.
  const cachedInputTokens = Math.min(input.cachedInputTokens, inputTokens);
  // Pricing for the chosen model must be configured; per spec, missing rates
  // (all-zero) leave cost null because we have no idea what the price is.
  if (
    rates.inputPerMillionUsdMicros === 0 &&
    rates.outputPerMillionUsdMicros === 0 &&
    rates.cachedInputPerMillionUsdMicros === 0
  ) {
    return null;
  }
  const freshInputTokens = Math.max(inputTokens - cachedInputTokens, 0);
  const baseMicros =
    (freshInputTokens * rates.inputPerMillionUsdMicros) / 1_000_000 +
    (cachedInputTokens * rates.cachedInputPerMillionUsdMicros) / 1_000_000 +
    (outputTokens * rates.outputPerMillionUsdMicros) / 1_000_000;
  return Math.round(baseMicros * input.pricing.promoMultiplier);
}

function pricingForModel(
  modelId: string,
  pricing: SettingsSnapshot["pricing"],
): {
  inputPerMillionUsdMicros: number;
  outputPerMillionUsdMicros: number;
  cachedInputPerMillionUsdMicros: number;
} | null {
  if (modelId === "composer-2-5-fast") return pricing.composer25Fast;
  if (modelId === "composer-2-5") return pricing.composer25;
  return null;
}

/**
 * Caller-side helper that accumulates `turn-ended.usage` observations across
 * all turns of a run. Each turn-ended event reports its own usage; the
 * harness keeps the running sum so the `runs` row reflects the total run
 * cost, not just the final turn. Returns the running snapshot as a fresh
 * object so the RunController can persist it directly.
 */
export function accumulateTurnEndedUsage(
  current: ParsedTurnEndedUsage | null,
  next: unknown,
): ParsedTurnEndedUsage | null {
  const parsed = turnEndedUsageShape.safeParse(next);
  if (!parsed.success) return current;
  if (current === null) return parsed.data;
  const sum: ParsedTurnEndedUsage = {
    inputTokens: addObserved(current.inputTokens, parsed.data.inputTokens),
    outputTokens: addObserved(current.outputTokens, parsed.data.outputTokens),
    cacheReadTokens: addObserved(current.cacheReadTokens, parsed.data.cacheReadTokens),
    cacheWriteTokens: addObserved(current.cacheWriteTokens, parsed.data.cacheWriteTokens),
    reasoningTokens: addObserved(current.reasoningTokens, parsed.data.reasoningTokens),
  };
  return sum;
}

/**
 * Parse a SINGLE `turn-ended.usage` payload without summing. Returns the
 * per-turn usage (or null on parse failure). RunController keeps the most
 * recent one as the context-occupancy estimate: a turn's `inputTokens`
 * already includes all prior context the model re-ingested, so the LAST
 * turn reflects how full the window is right now (and drops when Composer
 * self-summarizes). Distinct from `accumulateTurnEndedUsage`, which sums
 * across turns for the billing total on the `runs` row.
 */
export function parseTurnEndedUsage(next: unknown): ParsedTurnEndedUsage | null {
  const parsed = turnEndedUsageShape.safeParse(next);
  return parsed.success ? parsed.data : null;
}

function addObserved(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined || b === undefined) return undefined;
  return a + b;
}

// Re-export pricing helpers so callers don't need to thread `PricingSettings`
// explicitly when they already have a snapshot.
export type { PricingSettings };
