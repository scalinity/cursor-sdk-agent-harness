import { describe, expect, it } from "vitest";
import {
  CONTEXT_WINDOW_TOKENS,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  contextWindowForModel,
  contextBudgetSchema,
  deriveContextBudget,
  isSelfSummaryDrop,
} from "./context-budget.js";

describe("contextWindowForModel", () => {
  it("returns the per-model window for known models", () => {
    expect(contextWindowForModel("composer-2-5")).toBe(
      CONTEXT_WINDOW_TOKENS["composer-2-5"],
    );
    expect(contextWindowForModel("composer-2-5-fast")).toBe(
      CONTEXT_WINDOW_TOKENS["composer-2-5-fast"],
    );
  });

  it("falls back to the default window for unknown/null models", () => {
    expect(contextWindowForModel(null)).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS);
    expect(contextWindowForModel(undefined)).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS);
    expect(contextWindowForModel("gpt-everything")).toBe(
      DEFAULT_CONTEXT_WINDOW_TOKENS,
    );
  });
});

describe("deriveContextBudget", () => {
  it("computes occupancy as last-turn input + output and a clamped fraction", () => {
    const budget = deriveContextBudget({
      modelId: "composer-2-5",
      lastTurnInputTokens: 40_000,
      lastTurnOutputTokens: 10_000,
    });
    expect(budget.occupancyTokens).toBe(50_000);
    expect(budget.windowTokens).toBe(200_000);
    expect(budget.fraction).toBeCloseTo(0.25, 5);
    expect(budget.usageSource).toBe("derived");
    // Schema round-trips.
    expect(() => contextBudgetSchema.parse(budget)).not.toThrow();
  });

  it("clamps the fraction to 1 when occupancy exceeds the window", () => {
    const budget = deriveContextBudget({
      modelId: "composer-2-5",
      lastTurnInputTokens: 300_000,
      lastTurnOutputTokens: 50_000,
    });
    expect(budget.fraction).toBe(1);
  });

  it("reports unavailable (fraction 0) when no usage was delivered", () => {
    const budget = deriveContextBudget({
      modelId: "composer-2-5",
      lastTurnInputTokens: null,
      lastTurnOutputTokens: null,
    });
    expect(budget.usageSource).toBe("unavailable");
    expect(budget.fraction).toBe(0);
    expect(budget.occupancyTokens).toBe(0);
  });

  it("treats a single present field as derived usage", () => {
    const budget = deriveContextBudget({
      modelId: null,
      lastTurnInputTokens: 1_000,
      lastTurnOutputTokens: null,
    });
    expect(budget.usageSource).toBe("derived");
    expect(budget.occupancyTokens).toBe(1_000);
    expect(budget.windowTokens).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS);
  });
});

describe("isSelfSummaryDrop", () => {
  it("detects a sharp occupancy drop as self-summarization", () => {
    // 180k -> 5k is a classic Composer self-summary.
    expect(isSelfSummaryDrop(180_000, 5_000)).toBe(true);
  });

  it("does not flag a normal growing or mildly shrinking turn", () => {
    expect(isSelfSummaryDrop(100_000, 120_000)).toBe(false);
    expect(isSelfSummaryDrop(100_000, 90_000)).toBe(false);
  });

  it("returns false when data is missing or previous occupancy is zero", () => {
    expect(isSelfSummaryDrop(null, 5_000)).toBe(false);
    expect(isSelfSummaryDrop(180_000, null)).toBe(false);
    expect(isSelfSummaryDrop(0, 0)).toBe(false);
  });
});
