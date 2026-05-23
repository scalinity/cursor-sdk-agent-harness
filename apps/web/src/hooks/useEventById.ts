import { useMemo } from "react";
import { useRunStore, type CanonicalRunEvent } from "../state/run-store.js";

const EMPTY_EVENTS: CanonicalRunEvent[] = [];

export function useEventById(runId: string | null, eventId: string | null): CanonicalRunEvent | null {
  const events = useRunStore((s) =>
    runId ? (s.eventsByRunId[runId]?.events ?? EMPTY_EVENTS) : EMPTY_EVENTS,
  );
  return useMemo(() => {
    if (eventId === null) return null;
    return events.find((event) => event.event_id === eventId) ?? null;
  }, [events, eventId]);
}
