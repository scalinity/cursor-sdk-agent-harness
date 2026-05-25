import type { UsageSummary } from "@harness/shared";
import { formatMicros, formatTokens } from "../../lib/format.js";

function cacheHitRate(summary: UsageSummary): string {
  if (summary.totalInputTokens === 0) return "--";
  const pct = (100 * summary.totalCachedInputTokens) / summary.totalInputTokens;
  return `${pct.toFixed(1)}%`;
}

function cacheSavings(summary: UsageSummary): string {
  if (summary.totalInputTokens === 0) return "";
  const freshInputTokens = summary.totalInputTokens - summary.totalCachedInputTokens;
  return `${formatTokens(freshInputTokens)} fresh · ${formatTokens(summary.totalCachedInputTokens)} cached`;
}

export function UsageSummaryCards({ summary }: { summary: UsageSummary | null }) {
  const cards = [
    { label: "Runs", value: summary ? formatTokens(summary.totalRuns) : "--", detail: null },
    { label: "Cost", value: summary ? formatMicros(summary.totalCost) : "--", detail: null },
    { label: "Tokens", value: summary ? formatTokens(summary.totalTokens) : "--", detail: null },
    { label: "Cache hit rate", value: summary ? cacheHitRate(summary) : "--", detail: summary ? cacheSavings(summary) : null },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="border border-border-subtle bg-surface-1 p-3">
          <div className="text-xs uppercase tracking-uppercase text-text-tertiary">{card.label}</div>
          <div className="mono mt-2 text-xl text-text-primary">{card.value}</div>
          {card.detail ? <div className="mono mt-1 text-xs text-text-tertiary">{card.detail}</div> : null}
        </div>
      ))}
    </div>
  );
}
