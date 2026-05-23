import type { UsageSummary } from "@harness/shared";
import { formatMicros, formatTokens } from "../../lib/format.js";

export function UsageSummaryCards({ summary }: { summary: UsageSummary | null }) {
  const cards = [
    { label: "Runs", value: summary ? formatTokens(summary.totalRuns) : "--" },
    { label: "Cost", value: summary ? formatMicros(summary.totalCost) : "--" },
    { label: "Tokens", value: summary ? formatTokens(summary.totalTokens) : "--" },
    { label: "Usage unavailable", value: summary ? formatTokens(summary.unavailableCount) : "--" },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="border border-border-subtle bg-surface-1 p-3">
          <div className="text-xs uppercase tracking-uppercase text-text-tertiary">{card.label}</div>
          <div className="mono mt-2 text-xl text-text-primary">{card.value}</div>
        </div>
      ))}
    </div>
  );
}
