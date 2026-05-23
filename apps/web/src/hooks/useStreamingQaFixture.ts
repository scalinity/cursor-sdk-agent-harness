import { useEffect } from "react";
import type { CanonicalRunEvent, RunRecord, RunState } from "../state/run-store.js";
import { useRunStore } from "../state/run-store.js";

export interface StreamingQaFixtureInput {
  run: RunRecord;
  events: CanonicalRunEvent[];
  assistantText: string;
  thinkingText: string;
  toolCallCount: number;
}

function snapshotRunState(): Pick<RunState, "byId" | "eventsByRunId" | "activeRunId"> {
  const state = useRunStore.getState();
  return {
    byId: state.byId,
    eventsByRunId: state.eventsByRunId,
    activeRunId: state.activeRunId,
  };
}

export function useStreamingQaFixture(input: StreamingQaFixtureInput): void {
  useEffect(() => {
    const previous = snapshotRunState();
    useRunStore.setState({
      byId: { ...previous.byId, [input.run.id]: input.run },
      activeRunId: input.run.id,
      eventsByRunId: {
        ...previous.eventsByRunId,
        [input.run.id]: {
          seqList: input.events.map((item) => item.seq),
          bySeq: new Map(input.events.map((item) => [item.seq, item])),
          events: input.events,
          lastSeq: input.events.length,
          assistantText: input.assistantText,
          thinkingText: input.thinkingText,
          toolCallCount: input.toolCallCount,
        },
      },
    });

    return () => {
      useRunStore.setState(previous);
    };
  }, [input]);
}
