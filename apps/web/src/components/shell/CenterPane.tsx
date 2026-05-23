import type { AgentSummary, RunSummary } from "@harness/shared";
import { useRunStore } from "../../state/run-store.js";
import { CenterHeader } from "./CenterHeader.js";
import { EventTimeline } from "./EventTimeline.js";
import { Composer } from "./Composer.js";
import { ConnectionBanner } from "./ConnectionBanner.js";
import type { ConnectionState } from "../../state/ui-store.js";
import { StreamingSurfaceBoundary } from "../streaming/StreamingSurfaceBoundary.js";

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
  // Counts are maintained incrementally in the store (RV2-S4) so we read
  // them directly instead of scanning the seqList per render.
  const eventCount = useRunStore((s) =>
    activeRunId ? (s.eventsByRunId[activeRunId]?.seqList.length ?? 0) : 0,
  );
  const toolCallCount = useRunStore((s) =>
    activeRunId ? (s.eventsByRunId[activeRunId]?.toolCallCount ?? 0) : 0,
  );

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
        <StreamingSurfaceBoundary surface="chat-timeline">
          <EventTimeline runId={activeRunId} />
        </StreamingSurfaceBoundary>
      </div>
      <Composer activeAgent={activeAgent} onSubmit={onSubmit} />
    </main>
  );
}
