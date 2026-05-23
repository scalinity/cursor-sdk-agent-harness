import { useMemo, useRef } from "react";
import type { RunSummary, SdkRunStatus } from "@harness/shared";
import { cn } from "../../lib/cn.js";
import { useRunStore } from "../../state/run-store.js";
import { useMidnightTick } from "../../hooks/useMidnightTick.js";

/**
 * SessionsRail — left rail with the sessions list. Live/Today/Yesterday
 * groupings come from `runs`; the rail search box is decorative this
 * phase (the ⌘K shortcut focuses it for future search wiring).
 */
export interface SessionsRailProps {
  runs: RunSummary[];
  activeRunId: string | null;
  onSelectRun: (runId: string) => void;
}

type Bucket = "live" | "today" | "yesterday" | "earlier";

function bucketize(now: Date, run: RunSummary): Bucket {
  const isActive = run.status === "RUNNING" || run.status === "CREATING";
  if (isActive) return "live";
  const started = new Date(run.startedAt);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  if (started >= todayStart) return "today";
  if (started >= yesterdayStart) return "yesterday";
  return "earlier";
}

function dotClass(status: SdkRunStatus): string {
  if (status === "RUNNING" || status === "CREATING") return "rail-item__dot--run";
  if (status === "FINISHED") return "rail-item__dot--ok";
  if (status === "ERROR" || status === "CANCELLED" || status === "EXPIRED")
    return "rail-item__dot--err";
  return "";
}

export function SessionsRail({ runs, activeRunId, onSelectRun }: SessionsRailProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  // Re-render at the next midnight so today/yesterday buckets refresh
  // without requiring a manual reload (RV2-W17).
  const midnightTick = useMidnightTick();
  // Overlay the live run-store status over the REST RunSummary so an
  // in-flight status update (CANCELLED, FINISHED, …) from a stream
  // surfaces in the rail without waiting for the next REST reload
  // (RV2-S11).
  const runStoreById = useRunStore((s) => s.byId);
  const effectiveRuns = useMemo<RunSummary[]>(
    () =>
      runs.map((r) => {
        const live = runStoreById[r.id];
        return live?.status ? { ...r, status: live.status } : r;
      }),
    [runs, runStoreById],
  );
  const grouped = useMemo(() => {
    const now = new Date();
    const groups: Record<Bucket, RunSummary[]> = { live: [], today: [], yesterday: [], earlier: [] };
    for (const r of effectiveRuns) groups[bucketize(now, r)].push(r);
    return groups;
    // midnightTick is a load-bearing dep even though it's not read inside —
    // bumping it once per day forces recomputation so today/yesterday
    // buckets refresh without requiring `effectiveRuns` to change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRuns, midnightTick]);

  return (
    <aside className="sessions-rail">
      <div className="flex items-center justify-between px-3.5 pb-2 pt-3">
        <h1 className="m-0 text-xs font-semibold uppercase tracking-uppercase text-text-tertiary">
          Sessions
        </h1>
        <button
          type="button"
          className="grid size-5 place-items-center rounded-sm border border-border-subtle bg-surface-2 text-text-secondary"
          title="New session"
        >
          +
        </button>
      </div>

      <div className="mx-2.5 mb-2 flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-1 px-2 py-1 text-md text-text-tertiary">
        <input
          ref={searchRef}
          data-rail-search="true"
          placeholder="Search runs…"
          className="flex-1 bg-transparent text-text-primary placeholder:text-text-tertiary outline-none"
        />
        <span className="mono text-2xs">⌘K</span>
      </div>

      {grouped.live.length > 0 ? (
        <RailGroup
          label="Live"
          items={grouped.live}
          activeRunId={activeRunId}
          onSelectRun={onSelectRun}
        />
      ) : null}
      {grouped.today.length > 0 ? (
        <RailGroup
          label="Today"
          items={grouped.today}
          activeRunId={activeRunId}
          onSelectRun={onSelectRun}
        />
      ) : null}
      {grouped.yesterday.length > 0 ? (
        <RailGroup
          label="Yesterday"
          items={grouped.yesterday}
          activeRunId={activeRunId}
          onSelectRun={onSelectRun}
        />
      ) : null}
      {grouped.earlier.length > 0 ? (
        <RailGroup
          label="Earlier"
          items={grouped.earlier}
          activeRunId={activeRunId}
          onSelectRun={onSelectRun}
        />
      ) : null}
      {runs.length === 0 ? (
        <div className="px-3.5 pt-2 text-md text-text-tertiary">
          No runs yet. Start one from the composer.
        </div>
      ) : null}

      <div className="mt-auto border-t border-border-subtle p-2.5">
        <div className="flex items-center gap-2 p-1">
          <div className="grid size-6 place-items-center rounded-full bg-accent-bg text-2xs font-semibold text-accent-primary">
            HA
          </div>
          <div className="min-w-0">
            <div className="truncate text-md">Harness</div>
            <div className="text-2xs text-text-tertiary">local · single-user</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

interface RailGroupProps {
  label: string;
  items: RunSummary[];
  activeRunId: string | null;
  onSelectRun: (runId: string) => void;
}

function RailGroup({ label, items, activeRunId, onSelectRun }: RailGroupProps) {
  return (
    <div className="pb-1 pt-1.5">
      <h2 className="m-0 px-3.5 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-uppercase text-text-tertiary">
        {label}
      </h2>
      {items.map((run) => {
        const isActive = run.id === activeRunId;
        return (
          <div
            key={run.id}
            className={cn("rail-item", isActive && "rail-item--active")}
            onClick={() => onSelectRun(run.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelectRun(run.id);
            }}
          >
            <span className={cn("rail-item__dot", dotClass(run.status))} aria-hidden="true" />
            <div className="min-w-0">
              <div className="rail-item__title">{run.promptPreview || run.id}</div>
              <div className="rail-item__meta">
                {run.status.toLowerCase()} · {new Date(run.startedAt).toLocaleTimeString()}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
