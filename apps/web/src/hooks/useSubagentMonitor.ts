import { useCallback, useEffect, useMemo, useState } from "react";
import {
  subagentListResponseSchema,
  type SubagentListItem,
} from "@harness/shared";
import { HttpError, httpRequest } from "../lib/http-client.js";
import { useRunStore } from "../state/run-store.js";
import type { SubagentDashboardItem } from "../components/SubagentDashboard.js";

export interface UseSubagentMonitorResult {
  subagents: SubagentDashboardItem[];
  activeCount: number;
  completedCount: number;
  totalTokens: number;
  totalTokensPartial: boolean;
  totalCostMicros: number | null;
  hasSubagents: boolean;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

interface SubagentSnapshot {
  subagents: SubagentListItem[];
  activeCount: number;
  completedCount: number;
  totalTokens: number;
  totalTokensPartial: boolean;
  totalCostMicros: number | null;
}

const EMPTY_SNAPSHOT: SubagentSnapshot = {
  subagents: [],
  activeCount: 0,
  completedCount: 0,
  totalTokens: 0,
  totalTokensPartial: false,
  totalCostMicros: null,
};

function eventPreview(events: string[] | undefined): string[] {
  return events?.slice(-3) ?? [];
}

function childRunIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const childRunId = (payload as { child_run_id?: unknown }).child_run_id;
  return typeof childRunId === "string" ? childRunId : null;
}

function formatLifecycleEvent(event: { seq: number; kind: string; payload: unknown }): string {
  const status =
    typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload)
      ? (event.payload as { status?: unknown }).status
      : null;
  return `${event.seq} ${event.kind}${typeof status === "string" ? ` ${status}` : ""}`;
}

function elapsedMsFor(subagent: SubagentListItem, nowMs: number): number {
  const startedMs = Date.parse(subagent.startedAt);
  if (!Number.isFinite(startedMs)) return 0;
  const completedMs = subagent.completedAt ? Date.parse(subagent.completedAt) : nowMs;
  if (!Number.isFinite(completedMs)) return 0;
  return Math.max(0, completedMs - startedMs);
}

async function fetchSubagents(parentRunId: string): Promise<SubagentSnapshot> {
  return httpRequest(`/api/runs/${parentRunId}/subagents`, {
    responseSchema: subagentListResponseSchema,
  });
}

export function useSubagentMonitor(parentRunId: string | null): UseSubagentMonitorResult {
  const [snapshot, setSnapshot] = useState<SubagentSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const lifecycleKey = useRunStore((state) => {
    if (!parentRunId) return "";
    const events = state.eventsByRunId[parentRunId]?.subagentLifecycleEvents ?? [];
    return events.map((event) => `${event.seq}:${event.kind}`).join("|");
  });

  const childRunIdsKey = useMemo(
    () => snapshot.subagents.map((subagent) => subagent.runId).join("|"),
    [snapshot.subagents],
  );

  // Select a stable string fingerprint from the store so the selector never
  // allocates a new object (which would trip "getSnapshot should be cached").
  // The actual Record<string, string[]> is derived in useMemo below.
  const eventStreamsKey = useRunStore((state) => {
    if (childRunIdsKey.length === 0 || !parentRunId) return "";
    const parentEvents = state.eventsByRunId[parentRunId]?.subagentLifecycleEvents ?? [];
    return parentEvents.map((e) => `${e.seq}:${e.kind}`).join("|");
  });

  const eventStreamsByRunId = useMemo((): Record<string, string[]> => {
    if (childRunIdsKey.length === 0 || !parentRunId) return {};
    const childRunIds = new Set(childRunIdsKey.split("|"));
    const streams: Record<string, string[]> = {};
    for (const runId of childRunIds) {
      streams[runId] = [];
    }
    const parentEvents = useRunStore.getState().eventsByRunId[parentRunId]?.subagentLifecycleEvents ?? [];
    for (const event of parentEvents) {
      const childRunId = childRunIdFromPayload(event.payload);
      if (childRunId === null || !childRunIds.has(childRunId)) continue;
      streams[childRunId]?.push(formatLifecycleEvent(event));
    }
    return streams;
    // eventStreamsKey changes when the relevant events change — triggers recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentRunId, childRunIdsKey, eventStreamsKey]);

  const reload = useCallback(async () => {
    if (!parentRunId) {
      setSnapshot(EMPTY_SNAPSHOT);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await fetchSubagents(parentRunId));
    } catch (e) {
      setError(e instanceof HttpError ? e.message : "Failed to load sub-agents");
    } finally {
      setLoading(false);
    }
  }, [parentRunId]);

  useEffect(() => {
    if (!parentRunId) {
      setSnapshot(EMPTY_SNAPSHOT);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const refresh = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      setError(null);
      try {
        const next = await fetchSubagents(parentRunId);
        if (!cancelled) setSnapshot(next);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof HttpError ? e.message : "Failed to load sub-agents");
        }
      } finally {
        if (!cancelled && showLoading) setLoading(false);
      }
    };

    void refresh(true);
    const intervalMs = snapshot.activeCount > 0 || lifecycleKey.length > 0 ? 3_000 : 15_000;
    const interval = window.setInterval(() => {
      void refresh(false);
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [parentRunId, lifecycleKey, snapshot.activeCount]);

  useEffect(() => {
    if (snapshot.activeCount === 0) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [snapshot.activeCount]);

  const subagents = useMemo(
    () =>
      snapshot.subagents.map((subagent) => ({
        ...subagent,
        elapsedMs: elapsedMsFor(subagent, nowMs),
        eventPreview: eventPreview(eventStreamsByRunId[subagent.runId]),
        events: eventStreamsByRunId[subagent.runId] ?? [],
      })),
    [eventStreamsByRunId, nowMs, snapshot.subagents],
  );

  return {
    subagents,
    activeCount: snapshot.activeCount,
    completedCount: snapshot.completedCount,
    totalTokens: snapshot.totalTokens,
    totalTokensPartial: snapshot.totalTokensPartial,
    totalCostMicros: snapshot.totalCostMicros,
    hasSubagents: snapshot.subagents.length > 0,
    loading,
    error,
    reload,
  };
}
