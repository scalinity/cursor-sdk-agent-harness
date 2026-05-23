import { useMemo } from "react";
import type { AgentSummary, RunSummary } from "@harness/shared";
import { useRunStore } from "../../state/run-store.js";
import { CenterHeader } from "./CenterHeader.js";
import { EventTimeline } from "./EventTimeline.js";
import { Composer } from "./Composer.js";
import { ConnectionBanner } from "./ConnectionBanner.js";
import type { ConnectionState } from "../../state/ui-store.js";

export interface CenterPaneProps {
  activeAgent: AgentSummary | null;
  activeRun: RunSummary | null;
  activeRunId: string | null;
  connectionState: ConnectionState;
  onSubmit: (input: { prompt: string; agentId: string }) => Promise<string>;
}

export function CenterPane({
  activeAgent,
  activeRun,
  activeRunId,
  connectionState,
  onSubmit,
}: CenterPaneProps) {
  // Read event counts via selector — recomputed only when seqList grows.
  const seqList = useRunStore((s) =>
    activeRunId ? s.eventsByRunId[activeRunId]?.seqList ?? null : null,
  );
  const eventState = useRunStore((s) =>
    activeRunId ? s.eventsByRunId[activeRunId] ?? null : null,
  );
  const { eventCount, toolCallCount } = useMemo(() => {
    if (!seqList || !eventState) return { eventCount: 0, toolCallCount: 0 };
    let toolCalls = 0;
    for (const seq of seqList) {
      const e = eventState.bySeq.get(seq);
      if (e && e.sdk_type === "tool_call") toolCalls += 1;
    }
    return { eventCount: seqList.length, toolCallCount: toolCalls };
  }, [seqList, eventState]);

  return (
    <main className="center-pane">
      <CenterHeader
        activeAgent={activeAgent}
        activeRun={activeRun}
        toolCallCount={toolCallCount}
        eventCount={eventCount}
      />
      <div className="center-scroll">
        <ConnectionBanner connectionState={connectionState} />
        <EventTimeline runId={activeRunId} />
      </div>
      <Composer activeAgent={activeAgent} onSubmit={onSubmit} />
    </main>
  );
}
