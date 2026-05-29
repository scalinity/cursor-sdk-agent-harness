import { useEffect } from "react";
import { parseCodeEditPayload } from "../lib/code-edit-events.js";
import { deriveToolCallProjections, groupToolCallLanes } from "../lib/tool-call-projection.js";
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
    const toolCallProjections = deriveToolCallProjections(input.events);
    const codeEditEvents = input.events.filter((event) => event.kind === "code_edit.detected");
    const codeEditEventBySourceCallId: Record<string, CanonicalRunEvent> = {};
    for (const event of codeEditEvents) {
      const payload = parseCodeEditPayload(event.payload);
      if (payload?.source_call_id) codeEditEventBySourceCallId[payload.source_call_id] = event;
    }
    const subagentLifecycleEvents = input.events.filter(
      (event) => event.kind === "subagent.spawned" || event.kind === "subagent.completed",
    );
    useRunStore.setState({
      byId: { ...previous.byId, [input.run.id]: input.run },
      activeRunId: input.run.id,
      eventsByRunId: {
        ...previous.eventsByRunId,
        [input.run.id]: {
          seqList: input.events.map((item) => item.seq),
          bySeq: new Map(input.events.map((item) => [item.seq, item])),
          byEventId: new Map(input.events.map((item) => [item.event_id, item])),
          eventChunks: input.events.length > 0 ? [input.events] : [],
          eventsVersion: input.events.length,
          replayGeneration: 0,
          lastSeq: input.events.at(-1)?.seq ?? 0,
          lastReceivedAt: input.events.at(-1)?.received_at ?? null,
          assistantText: input.assistantText,
          thinkingText: input.thinkingText,
          thinkingDurationMs: null,
          toolCallCount: input.toolCallCount,
          toolCallProjections,
          toolCallGroups: groupToolCallLanes(toolCallProjections),
          codeEditEvents,
          codeEditEventBySourceCallId,
          subagentLifecycleEvents,
          approvalToolCallIdByRequestId: {},
          approvalsByRequestId: {},
        },
      },
    });

    return () => {
      useRunStore.setState(previous);
    };
  }, [input]);
}
