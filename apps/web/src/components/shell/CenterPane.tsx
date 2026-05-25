import type { AgentSummary, RunSummary, SdkImage } from "@harness/shared";
import { useRunStore } from "../../state/run-store.js";
import { useUiStore } from "../../state/ui-store.js";
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
  onSubmit: (input: { prompt: string; agentId: string; images?: SdkImage[] }) => Promise<string>;
  /**
   * Phase 13 — resolve an approval prompt by sending the
   * `approval_response` WS frame. Wired down to ApprovalPrompt via
   * EventTimeline. Owned by the parent (AppShell) so the hook lives
   * next to the WS sender.
   */
  onApprovalResolve?: (
    requestId: string,
    decision: "approve" | "deny",
    reason?: string,
  ) => void;
  /** Phase 13 — non-null when a CANCEL_UNAVAILABLE error frame arrived. */
  cancelUnavailable?: { message: string } | null;
}

export function CenterPane({
  activeAgent,
  activeRun,
  activeRunId,
  connectionState,
  onSubmit,
  onApprovalResolve,
  cancelUnavailable,
}: CenterPaneProps) {
  // eventCount drives heroMode (empty-state) detection; maintained incrementally
  // in the store (RV2-S4) so we read it directly instead of scanning seqList.
  const eventCount = useRunStore((s) =>
    activeRunId ? (s.eventsByRunId[activeRunId]?.seqList.length ?? 0) : 0,
  );
  // Hero "new session" mode: when the right pane is collapsed and there is no
  // active run / no events yet, present the composer centered (Cursor's
  // empty-state agent view) instead of an empty timeline + docked composer.
  const codeHidden = useUiStore((s) => s.codeHidden);
  const heroMode = codeHidden && activeRun === null && eventCount === 0;

  if (heroMode) {
    return (
      <main className="center-pane">
        <div className="center-hero">
          <Composer activeAgent={activeAgent} onSubmit={onSubmit} heroMode />
        </div>
      </main>
    );
  }

  return (
    <main className="center-pane">
      <div className="center-scroll">
        <ConnectionBanner connectionState={connectionState} />
        {cancelUnavailable ? (
          <div
            role="alert"
            className="cancel-unavailable-banner my-2 flex items-center gap-2 rounded-md border border-warning bg-surface-2 px-3 py-1.5 text-xs text-warning"
          >
            <span className="mono">CANCEL_UNAVAILABLE</span>
            <span>{cancelUnavailable.message}</span>
          </div>
        ) : null}
        <StreamingSurfaceBoundary surface="chat-timeline">
          <EventTimeline
            runId={activeRunId}
            {...(onApprovalResolve ? { onApprovalResolve } : {})}
          />
        </StreamingSurfaceBoundary>
      </div>
      <Composer activeAgent={activeAgent} onSubmit={onSubmit} />
    </main>
  );
}
