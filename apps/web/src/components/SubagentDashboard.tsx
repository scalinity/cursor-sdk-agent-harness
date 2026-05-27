import { useMemo, useState } from "react";
import type { SdkRunStatus, SubagentListItem } from "@harness/shared";
import { cn } from "../lib/cn.js";
import { formatDuration, formatMicros, formatTokens } from "../lib/format.js";

export interface SubagentDashboardItem extends SubagentListItem {
  elapsedMs?: number;
  eventPreview?: string[];
  events?: string[];
}

export interface SubagentDashboardProps {
  subagents: SubagentDashboardItem[];
  activeCount: number;
  completedCount: number;
  totalTokens?: number;
  totalTokensPartial?: boolean;
  totalCostMicros?: number | null;
  totalCostPartial?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const STATUS_CLASS: Record<SdkRunStatus, string> = {
  CREATING: "text-text-tertiary",
  RUNNING: "text-accent-primary run-status-pill--running",
  FINISHED: "text-success",
  ERROR: "text-danger",
  CANCELLED: "text-text-tertiary",
  EXPIRED: "text-text-tertiary",
};

const CARD_BORDER_CLASS: Record<SdkRunStatus, string> = {
  CREATING: "border-l-border-subtle",
  RUNNING: "border-l-accent-primary",
  FINISHED: "border-l-success",
  ERROR: "border-l-danger",
  CANCELLED: "border-l-border-subtle",
  EXPIRED: "border-l-border-subtle",
};

function subagentLabel(count: number): string {
  return `${formatTokens(count)} ${count === 1 ? "sub-agent" : "sub-agents"}`;
}

function elapsedFor(item: SubagentDashboardItem, now: number): string {
  if (typeof item.elapsedMs === "number") return formatDuration(Math.max(0, item.elapsedMs));
  const start = Date.parse(item.startedAt);
  if (!Number.isFinite(start)) return "--";
  const end = item.completedAt ? Date.parse(item.completedAt) : now;
  if (!Number.isFinite(end)) return "--";
  return formatDuration(Math.max(0, end - start));
}

function truncate(value: string, max = 40): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function eventLines(item: SubagentDashboardItem): string[] {
  const structured = (item.lastEvents ?? []).map((event) => `${event.kind}: ${truncate(event.summary)}`);
  if (structured.length > 0) return structured.slice(-5);
  return item.eventPreview?.slice(-5) ?? [];
}

function formatTokenCounter(value: number, partial: boolean): string {
  if (!partial) return formatTokens(value);
  if (value === 0) return "unavailable";
  return `partial ${formatTokens(value)}`;
}

function formatCostCounter(value: number | null, partial: boolean): string {
  if (value === null && partial) return "unavailable";
  if (value === null) return "--";
  if (!partial) return formatMicros(value);
  return `partial ${formatMicros(value)}`;
}

export function SubagentDashboard({
  subagents,
  activeCount,
  completedCount,
  totalTokens: totalTokensProp,
  totalTokensPartial: totalTokensPartialProp,
  totalCostMicros: totalCostMicrosProp,
  totalCostPartial: totalCostPartialProp,
  loading = false,
  error = null,
  onRetry,
}: SubagentDashboardProps) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [manualExpanded, setManualExpanded] = useState(false);
  const [manualCollapsed, setManualCollapsed] = useState(false);
  const now = Date.now();
  const totalTokens = useMemo(
    () => totalTokensProp ?? subagents.reduce((sum, item) => sum + item.tokenCount, 0),
    [subagents, totalTokensProp],
  );
  const totalTokensPartial = useMemo(
    () => totalTokensPartialProp ?? subagents.some((item) => item.tokenCountPartial),
    [subagents, totalTokensPartialProp],
  );
  const totalCostPartial = useMemo(
    () => totalCostPartialProp ?? subagents.some((item) => item.costMicros === null),
    [subagents, totalCostPartialProp],
  );
  const totalCostMicros = useMemo(() => {
    if (totalCostMicrosProp !== undefined) return totalCostMicrosProp;
    if (subagents.length === 0) return null;
    if (totalCostPartial) return null;
    return subagents.reduce((sum, item) => sum + (item.costMicros ?? 0), 0);
  }, [subagents, totalCostMicrosProp, totalCostPartial]);
  const summary = `${formatTokens(activeCount)} running, ${formatTokens(completedCount)} completed — ${formatTokenCounter(totalTokens, totalTokensPartial)} tokens`;
  const autoCollapsed = !loading && !error && activeCount === 0 && completedCount > 0 && subagents.length > 0;
  const collapsed = manualCollapsed || (autoCollapsed && !manualExpanded);
  const visibleSubagents = subagents.slice(0, 12);
  const overflowCount = Math.max(0, subagents.length - visibleSubagents.length);
  const collapsedSummary = activeCount > 0
    ? summary
    : `${subagentLabel(completedCount)} completed (${formatTokenCounter(totalTokens, totalTokensPartial)} tokens)`;

  if (collapsed) {
    return (
      <section
        aria-label="Sub-agent dashboard"
        className="subagent-dashboard border-b border-border-subtle bg-background px-4 py-3"
      >
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface-1 px-3 py-2 text-left text-sm text-text-primary"
          aria-label="Expand sub-agent dashboard"
          onClick={() => {
            setManualExpanded(true);
            setManualCollapsed(false);
          }}
        >
          <span>{collapsedSummary}</span>
          <span className="mono text-xs text-text-tertiary" aria-hidden="true">v</span>
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label="Sub-agent dashboard"
      className="subagent-dashboard border-b border-border-subtle bg-background px-4 py-3"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-uppercase text-text-tertiary">Sub-agents</div>
          <div className="mt-1 text-sm text-text-primary">{summary}</div>
        </div>
        <div className="mono flex items-center gap-2 text-xs text-text-tertiary">
          <span>{formatCostCounter(totalCostMicros, totalCostPartial)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatTokens(subagents.length)} total</span>
          <button
            type="button"
            className="rounded-sm border border-border-subtle bg-surface-1 px-2 py-1 text-text-secondary"
            aria-label="Collapse sub-agent dashboard"
            onClick={() => {
              setManualCollapsed(true);
              setManualExpanded(false);
            }}
          >
            ^
          </button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-md border border-danger bg-surface-2 px-3 py-2 text-xs text-danger">
          <span>{error}</span>
          {onRetry ? (
            <button type="button" className="mono rounded-sm border border-border-subtle bg-surface-1 px-2 py-1 text-text-primary" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {loading && subagents.length === 0 ? (
        <div className="mono rounded-md border border-border-subtle bg-surface-1 px-3 py-2 text-xs text-text-tertiary">
          Loading sub-agents
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visibleSubagents.map((item) => {
          const expanded = expandedRunId === item.runId;
          const preview = eventLines(item).slice(-5);
          const streamLines = item.events && item.events.length > 0 ? item.events : preview;
          const longRunning = item.completedAt === null && Date.parse(item.startedAt) + 300_000 < now;
          return (
            <article
              key={item.runId}
              data-testid="subagent-card"
              className={cn(
                "subagent-dashboard__card rounded-md border border-l-2 border-border-subtle bg-surface-1 p-3 shadow-1 transition",
                CARD_BORDER_CLASS[item.status],
              )}
            >
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 text-left"
                aria-expanded={expanded}
                onClick={() => setExpandedRunId(expanded ? null : item.runId)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-text-primary">{item.name}</span>
                  <span className="mono mt-1 block truncate text-xs text-text-tertiary">{item.runId}</span>
                </span>
                <span
                  className={cn(
                    "run-status-pill mono inline-flex h-control-sm shrink-0 items-center rounded-sm border border-border-subtle bg-surface-2 px-2 text-xs",
                    STATUS_CLASS[item.status],
                  )}
                >
                  <span className="run-status-pill__dot" aria-hidden="true" />
                  {item.status}
                </span>
              </button>

              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="uppercase tracking-uppercase text-text-tertiary">Elapsed</div>
                  <div className="mono mt-1 text-text-primary">{elapsedFor(item, now)}</div>
                </div>
                <div>
                  <div className="uppercase tracking-uppercase text-text-tertiary">Tokens</div>
                  <div className="mono mt-1 text-text-primary">{formatTokenCounter(item.tokenCount, item.tokenCountPartial)}</div>
                </div>
                <div>
                  <div className="uppercase tracking-uppercase text-text-tertiary">Cost</div>
                  <div className="mono mt-1 text-text-primary">{formatMicros(item.costMicros)}</div>
                </div>
              </div>
              {longRunning ? (
                <div className="mono mt-2 rounded-sm border border-warning bg-surface-2 px-2 py-1 text-xs text-warning">
                  long-running
                </div>
              ) : null}

              <div className="mt-3 border-t border-border-subtle pt-2">
                <div className="mb-1 text-xs uppercase tracking-uppercase text-text-tertiary">Recent events</div>
                {preview.length > 0 ? (
                  <ul className="space-y-1">
                    {preview.map((event, index) => (
                      <li key={`${item.runId}-${event}-${index}`} className="mono truncate text-xs text-text-secondary">
                        {event}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mono text-xs text-text-tertiary">waiting for events</div>
                )}
                {expanded ? (
                  <div className="mt-2 rounded-sm border border-border-subtle bg-surface-2 p-2">
                    <div className="mb-1 text-xs uppercase tracking-uppercase text-text-tertiary">Event stream</div>
                    <div className="space-y-1">
                      {streamLines.map((event, index) => (
                        <div key={`${item.runId}-stream-${event}-${index}`} className="mono text-xs text-text-secondary">
                          {event}
                        </div>
                      ))}
                      {streamLines.length === 0 ? (
                        <div className="mono text-xs text-text-tertiary">waiting for events</div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
        {overflowCount > 0 ? (
          <div className="mono flex min-h-24 items-center justify-center rounded-md border border-dashed border-border-subtle bg-surface-1 text-sm text-text-secondary">
            +{formatTokens(overflowCount)} more
          </div>
        ) : null}
      </div>
    </section>
  );
}
