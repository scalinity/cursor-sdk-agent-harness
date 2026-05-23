import { useMemo } from "react";
import { useRunStore } from "../../state/run-store.js";
import { UserMessage } from "../timeline/UserMessage.js";
import { AgentMessage } from "../timeline/AgentMessage.js";
import { ThinkingTrace } from "../timeline/ThinkingTrace.js";
import { ToolCallCard } from "../timeline/ToolCallCard.js";
import { SystemBanner } from "../timeline/SystemBanner.js";
import type { CanonicalRunEvent } from "../../state/run-store.js";

export interface EventTimelineProps {
  runId: string | null;
}

/**
 * Phase 08 timeline. Iterates events in seq order and renders a stub
 * component per kind. Assistant/thinking show the accumulator (not the
 * delta-by-delta event), but we still render an event marker so the
 * scroll position keeps pace with the stream. Phase 09 replaces this
 * with StreamingMarkdown and grouped tool-call lanes.
 */
export function EventTimeline({ runId }: EventTimelineProps) {
  const eventState = useRunStore((s) => (runId ? s.eventsByRunId[runId] ?? null : null));
  const events = useMemo<CanonicalRunEvent[]>(() => {
    if (!eventState) return [];
    return eventState.seqList.map((seq) => eventState.bySeq.get(seq)!).filter(Boolean);
  }, [eventState]);
  const assistantText = eventState?.assistantText ?? "";
  const thinkingText = eventState?.thinkingText ?? "";

  // Phase 08 trick: emit at most ONE AgentMessage block (using the
  // accumulator) and ONE ThinkingTrace block at the latest point in the
  // stream where either appeared. Other events render in order. The
  // streaming surfaces phase will replace this with proper iteration
  // boundaries and StreamingMarkdown.
  let assistantRendered = false;
  let thinkingRendered = false;
  const renderedAssistantTypes = new Set(["sdk.assistant"]);
  const renderedThinkingTypes = new Set(["sdk.thinking"]);

  if (!runId) {
    return (
      <div className="px-2 py-6 text-md text-text-tertiary">
        Select a run or send a prompt to start a new one.
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="px-2 py-6 text-md text-text-tertiary">No messages yet. Start a run.</div>
    );
  }

  return (
    <>
      {events.map((evt) => {
        if (evt.sdk_type === "system") {
          return <SystemBanner key={evt.event_id} event={evt} />;
        }
        if (evt.sdk_type === "user") {
          return <UserMessage key={evt.event_id} event={evt} />;
        }
        if (renderedAssistantTypes.has(`sdk.${evt.sdk_type}`)) {
          if (assistantRendered) return null;
          assistantRendered = true;
          return <AgentMessage key="assistant-accumulator" text={assistantText} />;
        }
        if (renderedThinkingTypes.has(`sdk.${evt.sdk_type}`)) {
          if (thinkingRendered) return null;
          thinkingRendered = true;
          return <ThinkingTrace key="thinking-accumulator" text={thinkingText} />;
        }
        if (evt.sdk_type === "tool_call") {
          return <ToolCallCard key={evt.event_id} event={evt} />;
        }
        // status / task / request — minimal generic line.
        return (
          <div key={evt.event_id} className="my-1 text-xs text-text-tertiary">
            <span className="mono">[{evt.kind}]</span>
            <span className="ml-2">{evt.occurred_at}</span>
          </div>
        );
      })}
    </>
  );
}
