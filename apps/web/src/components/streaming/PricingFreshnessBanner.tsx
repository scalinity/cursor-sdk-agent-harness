import type { PricingFreshness } from "@harness/shared";

export interface PricingFreshnessBannerProps {
  freshness: PricingFreshness;
  onOpenPricing: () => void;
  compact?: boolean;
}

function messageFor(freshness: PricingFreshness): string {
  if (freshness.staleness === "never_verified") {
    return "Pricing has never been verified. Costs may be missing or stale.";
  }
  if (freshness.staleness === "stale") {
    return `Pricing last verified ${freshness.lastVerifiedAt ?? "unknown"}. Refresh rates before trusting cost totals.`;
  }
  return "Pricing is fresh.";
}

export function PricingFreshnessBanner({
  freshness,
  onOpenPricing,
  compact = false,
}: PricingFreshnessBannerProps) {
  if (freshness.staleness === "fresh") return null;
  return (
    <div className="flex items-center justify-between gap-3 border border-warning bg-warning-bg px-3 py-2 text-sm text-text-secondary">
      <span>{messageFor(freshness)}</span>
      <button
        type="button"
        className="mono inline-flex h-control-md items-center rounded-sm border border-border-strong bg-surface-2 px-2 text-xs text-accent-primary hover:bg-surface-3"
        onClick={onOpenPricing}
      >
        {compact ? "Pricing" : "Open pricing"}
      </button>
    </div>
  );
}
