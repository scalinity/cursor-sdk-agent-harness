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
