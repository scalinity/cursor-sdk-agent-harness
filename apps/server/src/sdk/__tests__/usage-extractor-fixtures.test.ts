import { describe, expect, it } from "vitest";
import type { SettingsSnapshot } from "@harness/shared";
import { extractUsage } from "../usage-extractor.js";

/**
 * Phase 14 — explicit usage-parse fixture coverage per spec §11
 * "Usage Parse Failures". Each class is its own `it` block so a
 * regression points directly at the affected case.
 *
 * The fixture matrix:
 *   - known good          → sdk_final_result, all tokens populated, cost computed
 *   - missing fields      → unavailable, all tokens null, cost null
 *   - malformed           → unavailable, parse_error with rawShape
 *   - partial (input only)→ sdk_final_result, output null, cost null (cannot compute)
 *   - unknown shape       → unavailable, parse_error.rawShape captures keys
 */

const PRICING: SettingsSnapshot["pricing"] = {
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

describe("Phase 14 usage parse fixtures", () => {
  it("known-good: final_result with all four token fields", () => {
    const out = extractUsage({
      rawUsage: {
        inputTokens: 1_000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheWriteTokens: 100,
      },
      modelId: "composer-2-5-fast",
      pricing: PRICING,
    });
    expect(out.usage_source).toBe("sdk_final_result");
    expect(out.input_tokens).toBe(1_000);
    expect(out.output_tokens).toBe(500);
    expect(out.cached_input_tokens).toBe(200);
    expect(out.cost_usd_micros).toBeGreaterThan(0);
    expect(out.parseError).toBeUndefined();
  });

  it("missing-fields: final_result with no usage block", () => {
    const out = extractUsage({
      rawUsage: null,
      modelId: "composer-2-5-fast",
      pricing: PRICING,
    });
    expect(out.usage_source).toBe("unavailable");
    expect(out.input_tokens).toBeNull();
    expect(out.output_tokens).toBeNull();
    expect(out.cost_usd_micros).toBeNull();
  });

  it("malformed: final_result.usage is a string instead of an object", () => {
    const out = extractUsage({
      rawUsage: "not-an-object",
      modelId: "composer-2-5-fast",
      pricing: PRICING,
    });
    expect(out.usage_source).toBe("unavailable");
    expect(out.parseError).toBeDefined();
    expect(out.parseError?.rawShape).toBeDefined();
    // The shapeOf helper turns a bare string into "<string>" so a
    // SDK-side leak of a real token value doesn't ride into logs.
    expect(out.parseError?.rawShape).toBe("<string>");
  });

  it("partial: final_result.usage has only inputTokens", () => {
    const out = extractUsage({
      rawUsage: { inputTokens: 500 },
      modelId: "composer-2-5-fast",
      pricing: PRICING,
    });
    // The shape parses — we know inputTokens — but outputTokens is null
    // and the cost formula has no output rate to apply. The extractor
    // emits sdk_final_result with the partial tokens; cost is null only
    // if we can't compute it. With inputTokens alone and a positive
    // input rate, the formula DOES produce a positive cost; that's
    // accurate to the spec — the "cannot compute" case is when EVERY
    // rate is zero, not when one token field is missing.
    expect(out.usage_source).toBe("sdk_final_result");
    expect(out.input_tokens).toBe(500);
    expect(out.output_tokens).toBeNull();
    expect(out.cached_input_tokens).toBeNull();
    // 500 input tokens * $2/M = $0.001 = 1_000 micros, promo=1.0
    expect(out.cost_usd_micros).toBe(1_000);
  });

  it("unknown-shape: final_result.usage has keys we don't recognize", () => {
    const out = extractUsage({
      rawUsage: {
        totalTokens: 1_500,
        billing_unit: "characters",
        weirdKey: { nested: true },
      },
      modelId: "composer-2-5-fast",
      pricing: PRICING,
    });
    expect(out.usage_source).toBe("unavailable");
    expect(out.parseError).toBeDefined();
    // The rawShape should capture the keys (without their values) for
    // ledger feedback when the SDK shifts.
    const shape = out.parseError?.rawShape as Record<string, unknown>;
    expect(shape).toBeDefined();
    expect(Object.keys(shape).sort()).toEqual([
      "billing_unit",
      "totalTokens",
      "weirdKey",
    ]);
    // Values should be the type tags, not the literal data, so secrets
    // can't ride into the parse-error log.
    expect(shape.totalTokens).toBe("<number>");
    expect(shape.billing_unit).toBe("<string>");
  });

  it("malformed: final_result.usage with a string token count", () => {
    const out = extractUsage({
      rawUsage: { inputTokens: "1000", outputTokens: -3 },
      modelId: "composer-2-5-fast",
      pricing: PRICING,
    });
    expect(out.usage_source).toBe("unavailable");
    expect(out.parseError).toBeDefined();
    expect(out.parseError?.rawShape).toBeDefined();
  });
});
