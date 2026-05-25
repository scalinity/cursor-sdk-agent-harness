import { useMemo, useState } from "react";
import type { SdkRunStatus, SubagentListItem } from "@harness/shared";
import { cn } from "../lib/cn.js";
import { formatDuration, formatMicros, formatTokens } from "../lib/format.js";

export interface SubagentDashboardItem extends SubagentListItem {
  eventPreview?: string[];
  events?: string[];
}

export interface SubagentDashboardProps {
  subagents: SubagentDashboardItem[];
  activeCount: number;
  completedCount: number;
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

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatTokens(count)} ${count === 1 ? singular : plural}`;
}

function elapsedFor(item: SubagentDashboardItem, now: number): string {
  const start = Date.parse(item.startedAt);
  if (!Number.isFinite(start)) return "--";
  const end = item.completedAt ? Date.parse(item.completedAt) : now;
  if (!Number.isFinite(end)) return "--";
  return formatDuration(Math.max(0, end - start));
}

export function SubagentDashboard({
  subagents,
  activeCount,
  completedCount,
  loading = false,
  error = null,
  onRetry,
}: SubagentDashboardProps) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const now = Date.now();
  const totalTokens = useMemo(
    () => subagents.reduce((sum, item) => sum + item.tokenCount, 0),
    [subagents],
  );
  const summary = `${pluralize(activeCount, "agent")} active, ${formatTokens(completedCount)} completed`;

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
          <span>{formatTokens(totalTokens)} tokens</span>
          <span aria-hidden="true">·</span>
          <span>{formatTokens(subagents.length)} total</span>
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
        {subagents.map((item) => {
          const expanded = expandedRunId === item.runId;
          const preview = item.eventPreview?.slice(-3) ?? [];
          return (
            <article
              key={item.runId}
              className="subagent-dashboard__card rounded-md border border-border-subtle bg-surface-1 p-3 shadow-1 transition"
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
                  <div className="mono mt-1 text-text-primary">{formatTokens(item.tokenCount)}</div>
                </div>
                <div>
                  <div className="uppercase tracking-uppercase text-text-tertiary">Cost</div>
                  <div className="mono mt-1 text-text-primary">{formatMicros(item.costMicros)}</div>
                </div>
              </div>

              <div className="mt-3 border-t border-border-subtle pt-2">
                <div className="mb-1 text-xs uppercase tracking-uppercase text-text-tertiary">Events</div>
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
                      {(item.events ?? []).map((event, index) => (
                        <div key={`${item.runId}-stream-${event}-${index}`} className="mono text-xs text-text-secondary">
                          {event}
                        </div>
                      ))}
                      {(item.events ?? []).length === 0 ? (
                        <div className="mono text-xs text-text-tertiary">waiting for events</div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
