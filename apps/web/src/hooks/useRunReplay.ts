import { useEffect, useMemo, useState } from "react";
import {
  getRunEventsResponseSchema,
  type ReplaySpeed,
  type ServerFrame,
} from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useRunStore, type CanonicalRunEvent } from "../state/run-store.js";

export type RunReplayInput = {
  runId: string;
  speed: ReplaySpeed;
  paused: boolean;
  startFromSeq?: number;
};

export type RunReplayState = {
  currentSeq: number;
  visibleEvents: CanonicalRunEvent[];
  allEvents: CanonicalRunEvent[];
  isComplete: boolean;
  loading: boolean;
  error: string | null;
};

function toCanonical(frame: ServerFrame): CanonicalRunEvent | null {
  if (!("event" in frame)) return null;
  return {
    event_id: frame.event.event_id,
    schema_version: frame.event.schema_version,
    seq: frame.event.seq,
    agent_id: frame.event.agent_id,
    run_id: frame.event.run_id,
    occurred_at: frame.event.occurred_at,
    received_at: frame.event.received_at,
    sdk_type: frame.event.sdk_type,
    kind: frame.event.kind,
    payload: frame.event.payload,
    replayed: true,
  } as CanonicalRunEvent;
}

function delayFor(prev: ServerFrame | null, next: ServerFrame, speed: ReplaySpeed): number {
  if (speed === "instant") return 0;
  if (!prev || !("event" in prev) || !("event" in next)) return 0;
  const rawDelta = Date.parse(next.event.occurred_at) - Date.parse(prev.event.occurred_at);
  const bounded = Math.min(Math.max(rawDelta, 0), 2000);
  if (speed === "1x") return bounded;
  if (speed === "2x") return Math.min(bounded / 2, 1000);
  return Math.min(bounded / 4, 500);
}

async function fetchAllFrames(runId: string, signal: AbortSignal): Promise<ServerFrame[]> {
  const out: ServerFrame[] = [];
  let afterSeq = 0;
  for (;;) {
    const page = await httpRequest(`/api/runs/${runId}/events`, {
      query: { after_seq: afterSeq, limit: 2000 },
      responseSchema: getRunEventsResponseSchema,
      signal,
    });
    out.push(...page.items);
    if (page.nextAfterSeq === null) break;
    afterSeq = page.nextAfterSeq;
  }
  return out;
}

export function useRunReplay(input: RunReplayInput): RunReplayState {
  const [frames, setFrames] = useState<ServerFrame[]>([]);
  const [currentSeq, setCurrentSeq] = useState(input.startFromSeq ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resetRun = useRunStore((s) => s.resetRun);
  const ingestServerFrame = useRunStore((s) => s.ingestServerFrame);
  const visibleEvents = useRunStore((s) => s.eventsByRunId[input.runId]?.events ?? []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setFrames([]);
    setCurrentSeq(0);
    resetRun(input.runId);
    fetchAllFrames(input.runId, controller.signal)
      .then((next) => setFrames(next))
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "replay load failed");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [input.runId, resetRun]);

  useEffect(() => {
    const startSeq = input.startFromSeq ?? 0;
    resetRun(input.runId);
    for (const frame of frames) {
      if (!("event" in frame)) continue;
      if (frame.event.seq > startSeq) break;
      ingestServerFrame(frame, { replayed: true });
    }
    setCurrentSeq(startSeq);
  }, [frames, ingestServerFrame, input.runId, input.startFromSeq, resetRun]);

  useEffect(() => {
    if (loading || input.paused || frames.length === 0) return;
    const nextIndex = frames.findIndex((frame) => "event" in frame && frame.event.seq > currentSeq);
    if (nextIndex === -1) return;
    if (input.speed === "instant") {
      let lastSeq = currentSeq;
      for (const frame of frames.slice(nextIndex)) {
        if (!("event" in frame)) continue;
        ingestServerFrame(frame, { replayed: true });
        lastSeq = frame.event.seq;
      }
      setCurrentSeq(lastSeq);
      return;
    }
    const prev = nextIndex > 0 ? frames[nextIndex - 1] ?? null : null;
    const next = frames[nextIndex]!;
    const timeout = window.setTimeout(() => {
      if ("event" in next) {
        ingestServerFrame(next, { replayed: true });
        setCurrentSeq(next.event.seq);
      }
    }, delayFor(prev, next, input.speed));
    return () => window.clearTimeout(timeout);
  }, [currentSeq, frames, ingestServerFrame, input.paused, input.speed, loading]);

  const allEvents = useMemo(
    () => frames.map(toCanonical).filter((event): event is CanonicalRunEvent => event !== null),
    [frames],
  );
  const finalSeq = allEvents.at(-1)?.seq ?? 0;

  return {
    currentSeq,
    visibleEvents,
    allEvents,
    isComplete: frames.length > 0 && currentSeq >= finalSeq,
    loading,
    error,
  };
}
