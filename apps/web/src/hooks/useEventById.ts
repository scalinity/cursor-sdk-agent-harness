import { useRunStore, type CanonicalRunEvent } from "../state/run-store.js";

export function useEventById(runId: string | null, eventId: string | null): CanonicalRunEvent | null {
  return useRunStore((s) => {
    if (runId === null || eventId === null) return null;
    return s.eventsByRunId[runId]?.byEventId.get(eventId) ?? null;
  });
}
