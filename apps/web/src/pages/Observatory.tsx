import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CURSOR_SDK_CREDIT,
  CURSOR_SDK_DOCS_URL,
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
} from "@harness/shared";
import { SubagentDashboard } from "../components/SubagentDashboard.js";
import { UsageSummaryCards } from "../components/usage/UsageSummaryCards.js";
import { dateRangeForPreset } from "../lib/format.js";
import { formatBytes, formatCounterMs, useObservatory } from "../hooks/useObservatory.js";
import { useSubagentMonitor } from "../hooks/useSubagentMonitor.js";
import { useUsage } from "../hooks/useUsage.js";
import { useRunStore } from "../state/run-store.js";

const PERF_LABELS: Record<string, string> = {
  sdk_event_received_to_db_commit_ms: "SDK event → DB commit",
  db_commit_to_bus_publish_ms: "DB commit → bus publish",
  ws_flush_delay_ms: "WebSocket flush delay",
  cancel_unavailable_count: "Cancel unavailable (count)",
};

export function Observatory() {
  const initial = useMemo(() => dateRangeForPreset("7d"), []);
  const observatory = useObservatory();
  const usage = useUsage({ from: initial.from, to: initial.to });
  const activeRunId = useRunStore((s) => s.activeRunId);
  const subagentMonitor = useSubagentMonitor(activeRunId);
  const [usageExpanded, setUsageExpanded] = useState(false);

  const perfCards = observatory.perf
    ? Object.entries(observatory.perf.counters).map(([key, snapshot]) => ({
        key,
        label: PERF_LABELS[key] ?? key,
        value:
          key === "cancel_unavailable_count"
            ? String(snapshot.count)
            : formatCounterMs(snapshot),
        detail: key === "cancel_unavailable_count" ? null : `n=${snapshot.count}`,
      }))
    : [];

  return (
    <main className="min-h-screen bg-background p-4 text-text-primary">
      <div className="mx-auto flex max-w-screen-xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
          <div>
            <h1 className="text-2xl font-semibold">Observatory</h1>
            <p className="text-sm text-text-tertiary">
              {PRODUCT_TAGLINE} Forensic event log, live pipeline telemetry, and run analytics in one place.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link className="h-control-md rounded-sm border border-border-subtle px-3 py-1 text-sm text-text-secondary hover:bg-surface-1" to="/runs">
              Run history
            </Link>
            <Link className="h-control-md rounded-sm border border-border-subtle px-3 py-1 text-sm text-text-secondary hover:bg-surface-1" to="/usage">
              Usage detail
            </Link>
            <Link className="h-control-md rounded-sm border border-border-subtle px-3 py-1 text-sm text-text-secondary hover:bg-surface-1" to="/chat">
              Chat
            </Link>
          </div>
        </header>

        {observatory.error ? (
          <div className="border border-danger bg-danger-bg p-3 text-sm text-danger">{observatory.error}</div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-4">
          <div className="border border-border-subtle bg-surface-1 p-3">
            <div className="text-xs uppercase tracking-uppercase text-text-tertiary">Runs logged</div>
            <div className="mono mt-2 text-xl text-text-primary">
              {observatory.stats ? observatory.stats.runCount.toLocaleString() : "--"}
            </div>
          </div>
          <div className="border border-border-subtle bg-surface-1 p-3">
            <div className="text-xs uppercase tracking-uppercase text-text-tertiary">Canonical events</div>
            <div className="mono mt-2 text-xl text-text-primary">
              {observatory.stats ? observatory.stats.eventCount.toLocaleString() : "--"}
            </div>
          </div>
          <div className="border border-border-subtle bg-surface-1 p-3">
            <div className="text-xs uppercase tracking-uppercase text-text-tertiary">SQLite size</div>
            <div className="mono mt-2 text-xl text-text-primary">
              {formatBytes(observatory.stats?.dbBytes)}
            </div>
          </div>
          <div className="border border-border-subtle bg-surface-1 p-3">
            <div className="text-xs uppercase tracking-uppercase text-text-tertiary">Raw JSON retention</div>
            <div className="mono mt-2 text-xl text-text-primary">
              {observatory.stats ? `${observatory.stats.rawEventRetentionDays}d` : "--"}
            </div>
            <div className="mono mt-1 text-xs text-text-tertiary">Terminal runs only; payload_json kept for replay</div>
          </div>
        </section>

        <section className="border border-border-subtle bg-surface-1 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Pipeline telemetry</h2>
              <p className="text-sm text-text-tertiary">Server perf counters — persist-before-broadcast path (spec §13 budgets).</p>
            </div>
            {observatory.loading ? <span className="text-xs text-text-tertiary">Refreshing…</span> : null}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {perfCards.map((card) => (
              <div key={card.key} className="border border-border-subtle bg-background p-3">
                <div className="text-xs uppercase tracking-uppercase text-text-tertiary">{card.label}</div>
                <div className="mono mt-2 text-lg text-text-primary">{card.value}</div>
                {card.detail ? <div className="mono mt-1 text-xs text-text-tertiary">{card.detail}</div> : null}
              </div>
            ))}
          </div>
        </section>

        <section className="border border-border-subtle bg-surface-1 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Usage (7 days)</h2>
              <p className="text-sm text-text-tertiary">Honest micro-USD cost attribution — no local estimation when the SDK is silent.</p>
            </div>
            <button
              type="button"
              className="h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary hover:bg-surface-2"
              onClick={() => setUsageExpanded((value) => !value)}
            >
              {usageExpanded ? "Collapse" : "Expand cards"}
            </button>
          </div>
          {usage.error ? <div className="mb-3 text-sm text-danger">{usage.error.message}</div> : null}
          {usageExpanded ? <UsageSummaryCards summary={usage.summary} /> : (
            <div className="mono text-sm text-text-secondary">
              {usage.summary
                ? `${usage.summary.totalRuns} runs · ${usage.summary.costUnavailableCount > 0 ? "partial cost" : "cost tracked"} · open Usage for trends`
                : usage.loading
                  ? "Loading usage…"
                  : "No usage data yet"}
            </div>
          )}
        </section>

        <section className="border border-border-subtle bg-surface-1 p-3">
          <div className="mb-3">
            <h2 className="text-base font-semibold">Sub-agent monitor</h2>
            <p className="text-sm text-text-tertiary">
              {activeRunId
                ? "Live child runs for the active chat session."
                : "Start a chat run to watch spawned sub-agents here."}
            </p>
          </div>
          <SubagentDashboard
            subagents={subagentMonitor.subagents}
            activeCount={subagentMonitor.activeCount}
            completedCount={subagentMonitor.completedCount}
            totalTokens={subagentMonitor.totalTokens}
            totalTokensPartial={subagentMonitor.totalTokensPartial}
            totalCostMicros={subagentMonitor.totalCostMicros}
            totalCostPartial={subagentMonitor.totalCostPartial}
            loading={subagentMonitor.loading}
            error={subagentMonitor.error}
            onRetry={() => void subagentMonitor.reload()}
          />
        </section>

        <footer className="border-t border-border-subtle pt-3 text-sm text-text-tertiary">
          <p className="m-0">
            {PRODUCT_NAME} — {CURSOR_SDK_CREDIT}.{" "}
            <a className="text-accent-primary hover:underline" href={CURSOR_SDK_DOCS_URL} target="_blank" rel="noreferrer">
              SDK docs
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
