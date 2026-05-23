import { describe, expect, it } from "vitest";
import type { SettingsSnapshot } from "@harness/shared";
import { accumulateTurnEndedUsage, extractUsage } from "../usage-extractor.js";

const pricing: SettingsSnapshot["pricing"] = {
  composer25Fast: {
    inputPerMillionUsdMicros: 2_000_000, // $2/M
    outputPerMillionUsdMicros: 8_000_000, // $8/M
    cachedInputPerMillionUsdMicros: 200_000, // $0.20/M
  },
  composer25: {
    inputPerMillionUsdMicros: 5_000_000,
    outputPerMillionUsdMicros: 15_000_000,
    cachedInputPerMillionUsdMicros: 500_000,
  },
  promoMultiplier: 1.0,
  lastVerifiedAt: null,
};

describe("extractUsage", () => {
  it("returns unavailable when rawUsage is null", () => {
    expect(
      extractUsage({ rawUsage: null, modelId: "composer-2-5-fast", pricing }),
    ).toMatchObject({ usage_source: "unavailable", input_tokens: null, cost_usd_micros: null });
  });

  it("returns unavailable when rawUsage is undefined", () => {
    expect(
      extractUsage({ rawUsage: undefined, modelId: "composer-2-5-fast", pricing }),
    ).toMatchObject({ usage_source: "unavailable" });
  });

  it("records parseError but returns unavailable when shape is wrong", () => {
    const out = extractUsage({
      rawUsage: { inputTokens: "not-a-number", outputTokens: -3 },
      modelId: "composer-2-5-fast",
      pricing,
    });
    expect(out.usage_source).toBe("unavailable");
    expect(out.parseError).toBeDefined();
    expect(out.parseError?.rawShape).toBeDefined();
  });

  it("returns unavailable WITH parseError hint when every token field is missing", () => {
    const out = extractUsage({
      rawUsage: {},
      modelId: "composer-2-5-fast",
      pricing,
    });
    expect(out.usage_source).toBe("unavailable");
    expect(out.parseError?.message).toMatch(/every token field was missing/);
  });

  it("clamps cachedInputTokens to inputTokens when SDK reports cached > input", () => {
    const out = extractUsage({
      rawUsage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 300, // > inputTokens; clamp to 100
      },
      modelId: "composer-2-5-fast",
      pricing,
    });
    // After clamp: cached=100, fresh=0
    // Per the formula (rate per M tokens) / 1_000_000:
    //   fresh:  0   * 2_000_000  / 1_000_000 = 0
    //   cached: 100 *   200_000  / 1_000_000 = 20
    //   output: 50  * 8_000_000  / 1_000_000 = 400
    //   total micros = 420
    expect(out.cost_usd_micros).toBe(420);
  });

  it("computes cost from input/output/cache tokens with the harness formula", () => {
    const out = extractUsage({
      rawUsage: {
        inputTokens: 1_000_000,
        outputTokens: 200_000,
        cacheReadTokens: 100_000,
        cacheWriteTokens: 0,
      },
      modelId: "composer-2-5-fast",
      pricing,
    });
    // freshInputTokens = 1_000_000 - 100_000 = 900_000
    // baseMicros = 900_000 * 2_000_000 / 1_000_000  = 1_800_000
    //            + 100_000 * 200_000 / 1_000_000   =    20_000
    //            + 200_000 * 8_000_000 / 1_000_000 = 1_600_000
    //            = 3_420_000
    // promoMultiplier = 1.0 → 3_420_000 micros = $3.42
    expect(out.usage_source).toBe("sdk_final_result");
    expect(out.cost_usd_micros).toBe(3_420_000);
    expect(out.input_tokens).toBe(1_000_000);
    expect(out.output_tokens).toBe(200_000);
    expect(out.cached_input_tokens).toBe(100_000);
  });

  it("returns cost null when pricing for the model is all-zero", () => {
    const zeroPricing: SettingsSnapshot["pricing"] = {
      composer25Fast: {
        inputPerMillionUsdMicros: 0,
        outputPerMillionUsdMicros: 0,
        cachedInputPerMillionUsdMicros: 0,
      },
      composer25: {
        inputPerMillionUsdMicros: 0,
        outputPerMillionUsdMicros: 0,
        cachedInputPerMillionUsdMicros: 0,
      },
      promoMultiplier: 1,
      lastVerifiedAt: null,
    };
    const out = extractUsage({
      rawUsage: { inputTokens: 100, outputTokens: 200, cacheReadTokens: 0 },
      modelId: "composer-2-5-fast",
      pricing: zeroPricing,
    });
    expect(out.cost_usd_micros).toBeNull();
    expect(out.usage_source).toBe("sdk_final_result");
  });

  it("returns cost null when the model is not in the pricing snapshot", () => {
    const out = extractUsage({
      rawUsage: { inputTokens: 100, outputTokens: 200, cacheReadTokens: 0 },
      modelId: "unknown-model",
      pricing,
    });
    expect(out.cost_usd_micros).toBeNull();
  });

  it("applies promoMultiplier", () => {
    const promo: SettingsSnapshot["pricing"] = {
      ...pricing,
      promoMultiplier: 0.1,
    };
    const out = extractUsage({
      rawUsage: {
        inputTokens: 1_000_000,
        outputTokens: 200_000,
        cacheReadTokens: 100_000,
      },
      modelId: "composer-2-5-fast",
      pricing: promo,
    });
    // base 3_420_000 * 0.1 = 342_000
    expect(out.cost_usd_micros).toBe(342_000);
  });
});

describe("accumulateTurnEndedUsage", () => {
  it("starts from null and adds each turn", () => {
    let acc = accumulateTurnEndedUsage(null, {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
    });
    expect(acc?.inputTokens).toBe(100);
    acc = accumulateTurnEndedUsage(acc, {
      inputTokens: 80,
      outputTokens: 20,
      cacheReadTokens: 0,
    });
    expect(acc?.inputTokens).toBe(180);
    expect(acc?.outputTokens).toBe(70);
  });

  it("ignores updates that fail Zod parse", () => {
    const acc = accumulateTurnEndedUsage(null, { inputTokens: "bad" });
    expect(acc).toBeNull();
  });
});
