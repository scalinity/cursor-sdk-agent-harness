import type { UsageDailyPoint } from "@harness/shared";
import { formatMicros } from "../../lib/format.js";

export function UsageTrendChart({ points }: { points: UsageDailyPoint[] }) {
  const maxCost = Math.max(1, ...points.map((point) => point.cost));
  if (points.length === 0) {
    return <div className="border border-border-subtle bg-surface-1 p-4 text-sm text-text-tertiary">No usage recorded yet.</div>;
  }
  return (
    <div className="border border-border-subtle bg-surface-1 p-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-md font-semibold">Daily cost</h2>
        <span className="mono text-xs text-text-tertiary">{formatMicros(maxCost)} peak</span>
      </div>
      <svg className="h-40 w-full" role="img" aria-label="Daily cost trend" viewBox="0 0 720 160" preserveAspectRatio="none">
        {points.map((point, index) => {
          const width = 720 / points.length;
          const height = Math.max(2, (point.cost / maxCost) * 120);
          const x = index * width;
          const y = 128 - height;
          return (
            <g key={point.date}>
              <rect x={x + 2} y={y} width={Math.max(2, width - 4)} height={height} rx="2" className="fill-accent-soft" />
              <text x={x + width / 2} y="150" textAnchor="middle" className="fill-text-tertiary text-2xs">
                {point.date.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
