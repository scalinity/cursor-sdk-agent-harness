import { useMemo, useState } from "react";
import { useUsage } from "../hooks/useUsage.js";
import { useSettings } from "../hooks/useSettings.js";
import { dateRangeForPreset, isoDateInput } from "../lib/format.js";
import { PricingFreshnessBanner } from "../components/streaming/PricingFreshnessBanner.js";
import { PricingSettingsDialog } from "../components/settings/PricingSettingsDialog.js";
import { UsageSummaryCards } from "../components/usage/UsageSummaryCards.js";
import { UsageTrendChart } from "../components/usage/UsageTrendChart.js";
import { UsageBreakdownTable } from "../components/usage/UsageBreakdownTable.js";

type Preset = "24h" | "7d" | "30d" | "custom";

export function Usage() {
  const initial = useMemo(() => dateRangeForPreset("7d"), []);
  const [preset, setPreset] = useState<Preset>("7d");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [pricingOpen, setPricingOpen] = useState(false);
  const settings = useSettings();
  const usage = useUsage({ from, to });
  const pricingKey = settings.snapshot
    ? [
        settings.snapshot.pricing.composer25Fast.inputPerMillionUsdMicros,
        settings.snapshot.pricing.composer25Fast.outputPerMillionUsdMicros,
        settings.snapshot.pricing.composer25Fast.cachedInputPerMillionUsdMicros,
        settings.snapshot.pricing.composer25.inputPerMillionUsdMicros,
        settings.snapshot.pricing.composer25.outputPerMillionUsdMicros,
        settings.snapshot.pricing.composer25.cachedInputPerMillionUsdMicros,
        settings.snapshot.pricing.promoMultiplier,
        settings.snapshot.pricing.lastVerifiedAt ?? "never",
      ].join(":")
    : "pricing-loading";

  const applyPreset = (next: Exclude<Preset, "custom">) => {
    const range = dateRangeForPreset(next);
    setPreset(next);
    setFrom(range.from);
    setTo(range.to);
  };

  return (
    <main className="min-h-screen bg-background p-4 text-text-primary">
      <div className="mx-auto flex max-w-screen-xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
          <div>
            <h1 className="text-2xl font-semibold">Usage</h1>
            <p className="text-sm text-text-tertiary">Cost and token totals by date, model, and agent.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={preset === "24h" ? "h-control-md rounded-sm bg-accent-bg px-3 text-sm text-accent-primary" : "h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary"} type="button" onClick={() => applyPreset("24h")}>24h</button>
            <button className={preset === "7d" ? "h-control-md rounded-sm bg-accent-bg px-3 text-sm text-accent-primary" : "h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary"} type="button" onClick={() => applyPreset("7d")}>7d</button>
            <button className={preset === "30d" ? "h-control-md rounded-sm bg-accent-bg px-3 text-sm text-accent-primary" : "h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary"} type="button" onClick={() => applyPreset("30d")}>30d</button>
            <input className="h-control-md rounded-sm border border-border-subtle bg-surface-1 px-2 text-sm" type="date" value={isoDateInput(from)} onChange={(event) => { setPreset("custom"); setFrom(new Date(`${event.currentTarget.value}T00:00:00.000Z`)); }} />
            <input className="h-control-md rounded-sm border border-border-subtle bg-surface-1 px-2 text-sm" type="date" value={isoDateInput(to)} onChange={(event) => { setPreset("custom"); setTo(new Date(`${event.currentTarget.value}T23:59:59.999Z`)); }} />
          </div>
        </header>
        <PricingFreshnessBanner freshness={usage.pricingFreshness} onOpenPricing={() => setPricingOpen(true)} />
        {usage.error ? <div className="border border-danger bg-danger-bg p-3 text-sm text-danger">{usage.error.message}</div> : null}
        <UsageSummaryCards summary={usage.summary} />
        {usage.loading ? <div className="border border-border-subtle bg-surface-1 p-4 text-sm text-text-tertiary">Loading usage...</div> : null}
        <UsageTrendChart points={usage.daily} />
        <UsageBreakdownTable byModel={usage.byModel} byAgent={usage.byAgent} />
      </div>
      <PricingSettingsDialog
        key={pricingKey}
        open={pricingOpen}
        snapshot={settings.snapshot}
        onClose={() => setPricingOpen(false)}
        onSaved={() => void usage.reload()}
      />
    </main>
  );
}
