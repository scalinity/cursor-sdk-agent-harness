import type { TokenUsage } from "@harness/shared";
import { useRunStore } from "../../state/run-store.js";
import { useSettingsStore } from "../../state/settings-store.js";
import { cn } from "../../lib/cn.js";

export interface CostBadgeProps {
  runId: string | null;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

const integer = new Intl.NumberFormat("en-US");

function isTerminal(status: string | null | undefined): boolean {
  return status === "FINISHED" || status === "ERROR" || status === "CANCELLED" || status === "EXPIRED";
}

function tokenTotal(usage: TokenUsage): number | null {
  if (usage.input_tokens === null && usage.output_tokens === null) return null;
  return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
}

function formatUsage(usage: TokenUsage, active: boolean): string {
  const cost = usage.cost_usd_micros === null ? null : currency.format(usage.cost_usd_micros / 1_000_000);
  const tokens = tokenTotal(usage);
  const tokenText = tokens === null ? null : `${integer.format(tokens)} tok`;
  if (cost && tokenText) return `${active ? "~" : ""}${cost} · ${tokenText}`;
  if (cost) return `${active ? "~" : ""}${cost}`;
  if (tokenText) return `${active ? "~" : ""}${tokenText}`;
  return active ? "Usage pending" : "Usage unavailable";
}

function hasTokenUsage(usage: TokenUsage): boolean {
  return tokenTotal(usage) !== null;
}

function pricingStale(lastVerifiedAt: string | null | undefined): boolean {
  if (lastVerifiedAt === undefined) return false;
  if (lastVerifiedAt === null) return true;
  const parsed = Date.parse(lastVerifiedAt);
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed > 30 * 24 * 60 * 60 * 1000;
}

export function CostBadge({ runId }: CostBadgeProps) {
  const run = useRunStore((s) => (runId ? s.byId[runId] : null));
  const lastVerifiedAt = useSettingsStore((s) => s.snapshot?.pricing.lastVerifiedAt);
  if (!runId || !run) return null;

  const active = !isTerminal(run.status);
  const usage = run.usage;
  let label: string;
  let muted = false;

  if (active && !usage) {
    label = "Usage pending";
    muted = true;
  } else if (!active && (run.usageSource === "unavailable" || usage?.usage_source === "unavailable")) {
    label = "Usage unavailable";
    muted = true;
  } else if (!active && usage?.cost_usd_micros === null && hasTokenUsage(usage)) {
    label = "Tokens recorded, pricing not configured";
    muted = true;
  } else if (usage) {
    label = formatUsage(usage, active);
  } else {
    label = "Usage unavailable";
    muted = true;
  }

  return (
    <span
      className={cn(
        "cost-badge mono inline-flex h-control-sm items-center rounded-sm border border-border-subtle bg-surface-1 px-2 text-xs",
        muted ? "text-text-tertiary" : "text-text-secondary",
      )}
      title={pricingStale(lastVerifiedAt) ? "Pricing needs verification" : undefined}
    >
      <span>{label}</span>
      {pricingStale(lastVerifiedAt) ? <span className="ml-1 text-warning" aria-hidden="true"> · verify pricing</span> : null}
    </span>
  );
}
