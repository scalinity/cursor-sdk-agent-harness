import { z } from "zod";
import { isoDateTimeSchema } from "./constants.js";
import { modelIdSchema, type ModelId } from "./models.js";

// Pricing settings — see spec §8 default seed and §9 pricing keys.

export const PRICING_SETTING_KEYS = {
  fastInput: "pricing.composer-2-5-fast.input_per_million_usd_micros",
  fastOutput: "pricing.composer-2-5-fast.output_per_million_usd_micros",
  fastCachedInput: "pricing.composer-2-5-fast.cached_input_per_million_usd_micros",
  standardInput: "pricing.composer-2-5.input_per_million_usd_micros",
  standardOutput: "pricing.composer-2-5.output_per_million_usd_micros",
  standardCachedInput: "pricing.composer-2-5.cached_input_per_million_usd_micros",
  promoMultiplier: "pricing.promo_multiplier",
  lastVerifiedAt: "pricing.last_verified_at",
} as const;
export type PricingSettingKey =
  (typeof PRICING_SETTING_KEYS)[keyof typeof PRICING_SETTING_KEYS];

export const pricingPerMillionUsdMicrosSchema = z.number().int().nonnegative();
export const pricingPromoMultiplierSchema = z.number().min(0).max(1);

export const pricingValueSchemaByKey = {
  [PRICING_SETTING_KEYS.fastInput]: pricingPerMillionUsdMicrosSchema,
  [PRICING_SETTING_KEYS.fastOutput]: pricingPerMillionUsdMicrosSchema,
  [PRICING_SETTING_KEYS.fastCachedInput]: pricingPerMillionUsdMicrosSchema,
  [PRICING_SETTING_KEYS.standardInput]: pricingPerMillionUsdMicrosSchema,
  [PRICING_SETTING_KEYS.standardOutput]: pricingPerMillionUsdMicrosSchema,
  [PRICING_SETTING_KEYS.standardCachedInput]: pricingPerMillionUsdMicrosSchema,
  [PRICING_SETTING_KEYS.promoMultiplier]: pricingPromoMultiplierSchema,
  [PRICING_SETTING_KEYS.lastVerifiedAt]: isoDateTimeSchema.nullable(),
} as const;

export const modelPricingSchema = z.object({
  modelId: modelIdSchema,
  inputPerMillionUsdMicros: pricingPerMillionUsdMicrosSchema,
  outputPerMillionUsdMicros: pricingPerMillionUsdMicrosSchema,
  cachedInputPerMillionUsdMicros: pricingPerMillionUsdMicrosSchema,
});
export type ModelPricing = z.infer<typeof modelPricingSchema>;

export const pricingSettingsSchema = z.object({
  models: z.record(modelIdSchema, modelPricingSchema),
  promoMultiplier: pricingPromoMultiplierSchema,
  lastVerifiedAt: isoDateTimeSchema.nullable(),
});
export type PricingSettings = z.infer<typeof pricingSettingsSchema>;

export function dollarsPerMillionToMicros(valueUsd: number): number {
  return Math.round(valueUsd * 1_000_000);
}

export function microsToDollars(valueMicros: number): number {
  return valueMicros / 1_000_000;
}

/**
 * Cursor Composer 2.5 official pricing (cursor.com/docs/models-and-pricing).
 * Values are micro-USD per million tokens. Update when Cursor publishes new rates.
 */
export const DEFAULT_PRICING_MICROS = {
  composer25Fast: {
    inputPerMillionUsdMicros: dollarsPerMillionToMicros(3.0),
    outputPerMillionUsdMicros: dollarsPerMillionToMicros(15.0),
    cachedInputPerMillionUsdMicros: dollarsPerMillionToMicros(0.5),
  },
  composer25: {
    inputPerMillionUsdMicros: dollarsPerMillionToMicros(0.5),
    outputPerMillionUsdMicros: dollarsPerMillionToMicros(2.5),
    cachedInputPerMillionUsdMicros: dollarsPerMillionToMicros(0.2),
  },
} as const;

export function pricingKeyForModel(
  modelId: ModelId,
  field: "input" | "output" | "cachedInput",
): PricingSettingKey {
  if (modelId === "composer-2-5-fast") {
    if (field === "input") return PRICING_SETTING_KEYS.fastInput;
    if (field === "output") return PRICING_SETTING_KEYS.fastOutput;
    return PRICING_SETTING_KEYS.fastCachedInput;
  }
  if (field === "input") return PRICING_SETTING_KEYS.standardInput;
  if (field === "output") return PRICING_SETTING_KEYS.standardOutput;
  return PRICING_SETTING_KEYS.standardCachedInput;
}

/** Per-million-token rates (micro-USD) for one model — input, output, cached input. */
export interface ModelRateMicros {
  inputPerMillionUsdMicros: number;
  outputPerMillionUsdMicros: number;
  cachedInputPerMillionUsdMicros: number;
}

function rate(inputUsd: number, outputUsd: number, cachedInputUsd: number): ModelRateMicros {
  return {
    inputPerMillionUsdMicros: dollarsPerMillionToMicros(inputUsd),
    outputPerMillionUsdMicros: dollarsPerMillionToMicros(outputUsd),
    cachedInputPerMillionUsdMicros: dollarsPerMillionToMicros(cachedInputUsd),
  };
}

/**
 * Authoritative per-model rates for the frontier models Cursor proxies,
 * transcribed verbatim from cursor.com/docs/models (verified 2026-06-27). Values
 * are USD per million tokens; the "Cache Read" column maps to cached input.
 *
 * Why a table here and not only the composer settings: `Cursor.models.list()`
 * surfaces ~30 models (Claude / GPT-5.x / Gemini / Grok / Kimi / GLM / Composer),
 * but only the two composer ids have user-configurable settings rows. Without
 * rates for the rest, `computeCostMicros` returns null and every non-composer
 * run reports "cost unavailable" even though tokens are known. This table prices
 * the catalog so cost shows for any model.
 *
 * Rules are ordered MOST-SPECIFIC-FIRST; the first regex to match `modelId`
 * wins. Matching by family (not exact id) keeps pricing correct across point
 * releases and BYOK `provider:model` ids (the provider prefix is stripped
 * before matching). Composer 2.5 / 2.5-fast are intentionally absent — they stay
 * user-configurable through the pricing settings (see `pricingForModel`).
 *
 * KNOWN LIMITATION: a model's "fast" split (e.g. Opus fast at 6× list) is a
 * per-model PARAMETER, not a distinct model id (ledger OQ-31), so it is not
 * separately priced — the base rate is used. Flag if the SDK ever exposes a
 * fast variant as its own id. When Cursor publishes new rates, update here.
 */
export const CURSOR_MODEL_RATE_RULES: ReadonlyArray<readonly [RegExp, ModelRateMicros]> = [
  // — OpenAI GPT-5.x (version- and tier-specific; nano/mini/fast before base) —
  [/gpt-?5\.5/i, rate(5.0, 30.0, 0.5)],
  [/gpt-?5\.4.*nano/i, rate(0.2, 1.25, 0.02)],
  [/gpt-?5\.4.*mini/i, rate(0.75, 4.5, 0.075)],
  [/gpt-?5\.4/i, rate(2.5, 15.0, 0.25)],
  [/gpt-?5\.3/i, rate(1.75, 14.0, 0.175)],
  [/gpt-?5\.2/i, rate(1.75, 14.0, 0.175)],
  [/gpt-?5\.1.*mini/i, rate(0.25, 2.0, 0.025)],
  [/gpt-?5\.1/i, rate(1.25, 10.0, 0.125)],
  [/gpt-?5.*fast/i, rate(2.5, 20.0, 0.25)],
  [/gpt-?5.*mini/i, rate(0.25, 2.0, 0.025)],
  [/gpt-?5/i, rate(1.25, 10.0, 0.125)],
  // — Anthropic Claude —
  [/fable[-\s]?5/i, rate(10.0, 50.0, 1.0)],
  [/opus/i, rate(5.0, 25.0, 0.5)],
  [/sonnet/i, rate(3.0, 15.0, 0.3)],
  [/haiku/i, rate(1.0, 5.0, 0.1)],
  // — Google Gemini (3.5-flash before 3-flash; 3-flash ≠ 2.5-flash) —
  [/gemini-?3\.5.*flash/i, rate(1.5, 9.0, 0.15)],
  [/gemini-?2\.5.*flash/i, rate(0.3, 2.5, 0.03)],
  [/gemini-?3.*flash/i, rate(0.5, 3.0, 0.05)],
  [/gemini.*pro/i, rate(2.0, 12.0, 0.2)],
  // — xAI Grok (build / 4.20 before the 4.3 base) —
  [/grok.*build/i, rate(1.0, 2.0, 0.2)],
  [/grok-?4\.20/i, rate(2.0, 6.0, 0.2)],
  [/grok/i, rate(1.25, 2.5, 0.2)],
  // — Moonshot / Z.ai —
  [/kimi/i, rate(0.6, 3.0, 0.1)],
  [/glm/i, rate(1.4, 4.4, 0.26)],
  // — Cursor Composer (older ids; 2.5 + 2.5-fast come from settings) —
  [/composer-?1\.5/i, rate(3.5, 17.5, 0.35)],
  [/composer-?1/i, rate(1.25, 10.0, 0.125)],
  [/composer-?2/i, rate(0.5, 2.5, 0.2)],
];

/**
 * Resolve published per-million rates for a Cursor catalog model, or null when
 * the model is unknown (callers leave `cost_usd_micros` null — never estimate).
 * A BYOK-style `provider:model` id has its provider prefix stripped first so the
 * family rules match the bare model name.
 */
export function cursorModelRateMicros(modelId: string): ModelRateMicros | null {
  const colon = modelId.lastIndexOf(":");
  const bare = colon >= 0 ? modelId.slice(colon + 1) : modelId;
  for (const [pattern, rates] of CURSOR_MODEL_RATE_RULES) {
    if (pattern.test(bare)) return rates;
  }
  return null;
}
