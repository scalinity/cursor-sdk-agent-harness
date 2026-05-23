import { useMemo } from "react";
import { deriveToolCallProjections, groupToolCallLanes } from "../lib/tool-call-projection.js";
import { useRunStore, type CanonicalRunEvent } from "../state/run-store.js";

const EMPTY_EVENTS: CanonicalRunEvent[] = [];

export function useToolCallProjection(runId: string | null) {
  const events = useRunStore((s) => (runId ? (s.eventsByRunId[runId]?.events ?? EMPTY_EVENTS) : EMPTY_EVENTS));
  return useMemo(() => {
    const calls = deriveToolCallProjections(events);
    return { calls, groups: groupToolCallLanes(calls) };
  }, [events]);
}
