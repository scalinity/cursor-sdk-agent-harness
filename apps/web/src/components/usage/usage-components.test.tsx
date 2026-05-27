import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UsageBreakdownTable } from "./UsageBreakdownTable.js";
import { UsageSummaryCards } from "./UsageSummaryCards.js";
import { UsageTrendChart } from "./UsageTrendChart.js";

const freshness = { lastVerifiedAt: null, staleness: "never_verified" as const };

describe("usage aggregate components", () => {
  it("labels summary totals as partial when aggregate counters include missing usage", () => {
    render(
      <UsageSummaryCards
        summary={{
          totalRuns: 3,
          totalCost: 4567,
          totalTokens: 350,
          unavailableCount: 1,
          costUnavailableCount: 2,
          tokenUnavailableCount: 2,
          cacheUnavailableCount: 1,
          totalInputTokens: 250,
          totalOutputTokens: 100,
          totalCachedInputTokens: 20,
          totalReasoningTokens: 0,
          totalCostUsdMicros: 4567,
          bySource: { sdk_final_result: 2, derived: 0, unavailable: 1 },
          pricingFreshness: freshness,
        }}
      />,
    );

    expect(screen.getByText("partial $0.004567")).toBeTruthy();
    expect(screen.getByText("partial 350")).toBeTruthy();
    expect(screen.getByText("unavailable")).toBeTruthy();
    expect(screen.getByText("cache data incomplete for one or more runs")).toBeTruthy();
  });

  it("labels trend and breakdown cost/tokens as partial when a bucket has unavailable usage", () => {
    render(
      <>
        <UsageTrendChart
          points={[
            {
              date: "2026-05-20",
              cost: 4567,
              tokens: 350,
              costUnavailableCount: 2,
              tokenUnavailableCount: 2,
              cacheUnavailableCount: 0,
            },
          ]}
        />
        <UsageBreakdownTable
          byModel={[{ id: "composer", name: "composer", runs: 3, cost: 4567, tokens: 350, costUnavailableCount: 2, tokenUnavailableCount: 2 }]}
          byAgent={[{ id: "agent", name: "Agent", runs: 3, cost: 4567, tokens: 350, costUnavailableCount: 2, tokenUnavailableCount: 2 }]}
        />
      </>,
    );

    expect(screen.getByText("partial $0.004567 peak")).toBeTruthy();
    expect(screen.getAllByText("partial 350").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("partial $0.004567").length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole("button", { name: /by agent/i }));
    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.getAllByText("partial 350").length).toBeGreaterThanOrEqual(1);
  });
});
