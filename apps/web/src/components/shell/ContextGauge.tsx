import {
  CONTEXT_WARN_FRACTION,
  CONTEXT_DANGER_FRACTION,
  type ContextBudget,
} from "@harness/shared";

/**
 * ContextGauge — small SVG ring showing how full the agent's context window
 * is. Fills as the conversation accumulates tokens; visibly *drops* when
 * Composer self-summarizes (cursor.com/blog/self-summarization). Token-colored
 * via the design-system semantic palette (no hardcoded colors).
 *
 * Presentational — zero state, zero useEffect. Derives everything from the
 * passed ContextBudget (produced by useContextBudget).
 */

const SIZE = 14;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function gaugeColorClass(fraction: number): string {
  if (fraction >= CONTEXT_DANGER_FRACTION) return "text-danger";
  if (fraction >= CONTEXT_WARN_FRACTION) return "text-warning";
  return "text-text-tertiary";
}

export function ContextGauge({ budget }: { budget: ContextBudget | null }) {
  // Unavailable: empty dimmed ring with no percentage.
  if (!budget || budget.usageSource === "unavailable") {
    return (
      <span
        className="inline-flex items-center gap-1 text-text-quaternary"
        title="Context usage unknown — no SDK usage reported yet"
      >
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="opacity-30"
          aria-hidden="true"
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
          />
        </svg>
      </span>
    );
  }

  const offset = CIRCUMFERENCE * (1 - budget.fraction);
  const pct = Math.round(budget.fraction * 100);
  const tooltipParts = [
    `Context: ${formatTokens(budget.occupancyTokens)} / ${formatTokens(budget.windowTokens)} (${pct}%)`,
    "window assumed · usage from SDK",
  ];
  if (budget.fraction >= CONTEXT_DANGER_FRACTION) {
    tooltipParts.push("context filling up — Composer will self-summarize, or start a fresh session");
  }
  const tooltip = tooltipParts.join(" · ");

  return (
    <span
      className={`inline-flex items-center gap-1 ${gaugeColorClass(budget.fraction)}`}
      title={tooltip}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="-rotate-90"
        aria-label={`Context fill ${pct}%`}
        role="img"
      >
        {/* Background track */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          className="opacity-20"
        />
        {/* Fill arc */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="duration-slow"
          style={{ transition: "stroke-dashoffset var(--duration-slow) ease, color var(--duration-slow) ease" }}
        />
      </svg>
      <span className="mono">{pct}%</span>
    </span>
  );
}
