/**
 * useRunHealth — Phase 13 timeline stall warnings.
 *
 * Ticks every 2s and derives:
 *  - per-tool-call "still running" (>30s) and "long-running" (>120s) badges
 *  - per-run "stalled" banner when the most recent event is older than
 *    180s AND the run is in CREATING/RUNNING state
 *
 * Computed from incremental run-store projections and `lastReceivedAt`.
 * No new server data needed — Section 11 thresholds are pure clock math
 * against the canonical event log.
 *
 * The hook does not subscribe to a tick interval in components — that
 * would burn cycles even when nothing is rendering. Instead it owns a
 * single setInterval and forces a re-read via `useSyncExternalStore`.
 */
import { useEffect, useMemo, useState } from "react";
import { useRunStore } from "../state/run-store.js";

const STILL_RUNNING_MS = 30_000;
const LONG_RUNNING_MS = 120_000;
const RUN_STALLED_MS = 180_000;
const TICK_MS = 2_000;

export interface ToolCallHealth {
  callId: string;
  startedAt: string;
  /** ms since `startedAt`, computed on each tick. */
  elapsedMs: number;
  /** True when elapsed > 30s and the call hasn't completed. */
  stillRunning: boolean;
  /** True when elapsed > 120s and the call hasn't completed. */
  longRunning: boolean;
}

export interface UseRunHealthResult {
  /**
   * Map of running tool-call `call_id` -> health state. Excludes
   * completed / errored tool calls.
   */
  toolCallHealth: Record<string, ToolCallHealth>;
  /** True when the run hasn't emitted any event in RUN_STALLED_MS. */
  runStalled: boolean;
  /** ms since the most recent event for the run; null when no events. */
  msSinceLastEvent: number | null;
}

let externalNowMs: () => number = () => Date.now();
/**
 * Test seam: lets a test inject a deterministic clock so the stall
 * thresholds can be observed without sleeping for 3 minutes.
 */
export function __setUseRunHealthClockForTests(fn: () => number): void {
  externalNowMs = fn;
}

/**
 * Internal ticker. Single setInterval per hook consumer at TICK_MS
 * cadence; the returned counter drives `useMemo` recomputation so
 * subscribers re-render even when no events have arrived. Cheap
 * (a 2s interval over a small N) and only active while the consumer
 * is mounted.
 */
function useHealthTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return tick;
}

export function useRunHealth(runId: string | null): UseRunHealthResult {
  const tick = useHealthTick();
  const toolCallProjections = useRunStore((s) =>
    runId ? (s.eventsByRunId[runId]?.toolCallProjections ?? null) : null,
  );
  const lastReceivedAt = useRunStore((s) =>
    runId ? (s.eventsByRunId[runId]?.lastReceivedAt ?? null) : null,
  );
  const runRecord = useRunStore((s) =>
    runId ? (s.byId[runId] ?? null) : null,
  );

  // Running tool timing is already projected during ingest, so ticks only
  // walk the currently running calls instead of every event in the run.
  const runningTiming = useMemo(() => {
    const running: Record<string, { startedAt: string }> = {};
    for (const projection of toolCallProjections ?? []) {
      if (projection.status === "running") {
        running[projection.callId] = { startedAt: projection.startedAt };
      }
    }
    return running;
  }, [toolCallProjections]);

  return useMemo(() => {
    void tick; // recompute on every tick
    const now = externalNowMs();
    if (!runId) {
      return { toolCallHealth: {}, runStalled: false, msSinceLastEvent: null };
    }
    const toolCallHealth: Record<string, ToolCallHealth> = {};
    for (const [callId, t] of Object.entries(runningTiming)) {
      const startMs = Date.parse(t.startedAt);
      if (Number.isNaN(startMs)) continue;
      const elapsed = Math.max(0, now - startMs);
      toolCallHealth[callId] = {
        callId,
        startedAt: t.startedAt,
        elapsedMs: elapsed,
        stillRunning: elapsed > STILL_RUNNING_MS,
        longRunning: elapsed > LONG_RUNNING_MS,
      };
    }

    const lastEventMs = lastReceivedAt ? Date.parse(lastReceivedAt) : NaN;
    const msSinceLastEvent = Number.isNaN(lastEventMs)
      ? null
      : Math.max(0, now - lastEventMs);

    // RV2-S3: only CREATING/RUNNING runs can be "stalled". A null
    // status means we have no info yet (e.g. summary not loaded) —
    // treat that as not stalled rather than potentially showing a
    // banner for a run we've never seen status for.
    const status = runRecord?.status ?? null;
    const isActive = status === "CREATING" || status === "RUNNING";
    const runStalled =
      isActive && msSinceLastEvent !== null && msSinceLastEvent > RUN_STALLED_MS;

    return { toolCallHealth, runStalled, msSinceLastEvent };
  }, [tick, runId, runningTiming, lastReceivedAt, runRecord]);
}

export const RUN_HEALTH_THRESHOLDS = {
  STILL_RUNNING_MS,
  LONG_RUNNING_MS,
  RUN_STALLED_MS,
  TICK_MS,
} as const;
