import { useRunStore } from "../../state/run-store.js";
import { UserMessage } from "../timeline/UserMessage.js";
import { StreamingMarkdown } from "../streaming/StreamingMarkdown.js";
import { ThinkingTrace } from "../streaming/ThinkingTrace.js";
import { ToolCallLane } from "../streaming/ToolCallLane.js";
import { SystemBanner } from "../streaming/SystemBanner.js";
import { RunStatusPill } from "../streaming/RunStatusPill.js";
import { StreamingSurfaceBoundary } from "../streaming/StreamingSurfaceBoundary.js";
import { CodeEditPreviewPanel } from "../streaming/CodeEditPreviewPanel.js";
import { ApprovalPrompt } from "../streaming/ApprovalPrompt.js";
import { useRunHealth } from "../../hooks/useRunHealth.js";

export interface EventTimelineProps {
  runId: string | null;
  /**
   * Phase 13 — invoked when the user clicks Approve/Deny on an
   * ApprovalPrompt. The hook owning the WS sender (AppShell ->
   * useApprovalActions) wires this through.
   */
  onApprovalResolve?: (
    requestId: string,
    decision: "approve" | "deny",
    reason?: string,
  ) => void;
}

/**
 * Phase 09 timeline. Events remain the canonical ordering source, but related
 * deltas are rendered through aggregate streaming surfaces: one assistant
 * markdown stream, one thinking trace, grouped tool-call lanes, code-edit
 * preview placeholders, and status/usage badges. Live and replay both feed the
 * same run-store projections, so surfaces avoid per-token React commits while
 * preserving event order for surrounding markers.
 */
export function EventTimeline({ runId, onApprovalResolve }: EventTimelineProps) {
  const events = useRunStore((s) =>
    runId ? (s.eventsByRunId[runId]?.events ?? null) : null,
  );
  const approvalsMap = useRunStore((s) =>
    runId ? (s.eventsByRunId[runId]?.approvalsByRequestId ?? null) : null,
  );
  const { runStalled } = useRunHealth(runId);

  if (!runId) {
    return (
      <div className="px-2 py-6 text-md text-text-tertiary">
        Select a run or send a prompt to start a new one.
      </div>
    );
  }
  if (!events || events.length === 0) {
    return (
      <div className="px-2 py-6 text-md text-text-tertiary">No messages yet. Start a run.</div>
    );
  }

  let assistantRendered = false;
  let thinkingRendered = false;
  let toolLaneRendered = false;
  let codeEditRendered = false;

  return (
    <>
      {runStalled ? (
        <div
          role="alert"
          className="run-stalled-banner my-2 flex items-center gap-2 rounded-md border border-warning bg-surface-2 px-3 py-1.5 text-xs text-warning"
        >
          <span>
            Run stalled: no event received in the last 3 minutes. The agent
            may be stuck on a long-running tool.
          </span>
        </div>
      ) : null}
      {events.map((evt) => {
        if (evt.sdk_type === "system") {
          return (
            <StreamingSurfaceBoundary key={evt.event_id} surface="system-banner">
              <SystemBanner event={evt} />
            </StreamingSurfaceBoundary>
          );
        }
        if (evt.sdk_type === "user") {
          return <UserMessage key={evt.event_id} event={evt} />;
        }
        if (evt.sdk_type === "thinking") {
          if (thinkingRendered) return null;
          thinkingRendered = true;
          return (
            <StreamingSurfaceBoundary key={`thinking-${runId}`} surface="thinking-trace">
              <ThinkingTrace runId={runId} />
            </StreamingSurfaceBoundary>
          );
        }
        if (evt.sdk_type === "assistant") {
          if (assistantRendered) return null;
          assistantRendered = true;
          return (
            <div key={`assistant-${runId}`} className="agent-message">
              <div className="agent-message__head">
                <span className="agent-message__glyph mono">A</span>
                <span className="font-semibold text-accent-primary">Harness</span>
                <span className="mono text-xs text-text-tertiary">
                  {new Date(evt.occurred_at).toLocaleTimeString()}
                </span>
              </div>
              <StreamingSurfaceBoundary surface="assistant-markdown">
                <StreamingMarkdown runId={runId} source="assistant" />
              </StreamingSurfaceBoundary>
            </div>
          );
        }
        if (evt.sdk_type === "tool_call") {
          if (evt.kind === "code_edit.detected") {
            if (codeEditRendered) return null;
            codeEditRendered = true;
            return (
              <StreamingSurfaceBoundary key={`code-edits-${runId}`} surface="code-edits">
                <CodeEditPreviewPanel runId={runId} />
              </StreamingSurfaceBoundary>
            );
          }
          if (toolLaneRendered) return null;
          toolLaneRendered = true;
          return (
            <StreamingSurfaceBoundary key={`tool-calls-${runId}`} surface="tool-calls">
              <ToolCallLane runId={runId} />
            </StreamingSurfaceBoundary>
          );
        }
        if (evt.sdk_type === "status") {
          return (
            <div key={evt.event_id} className="my-2 flex items-center gap-2 text-xs text-text-tertiary">
              <span className="mono">[{evt.kind}]</span>
              <RunStatusPill runId={runId} />
            </div>
          );
        }
        if (evt.sdk_type === "request" && evt.kind === "request.created") {
          // RV2-W6: render the inline ApprovalPrompt directly from
          // `approvalsByRequestId`. The store projects this map from
          // both `request.created` and `approval.resolved`/`.failed`
          // frames, so a request whose `request.created` row was
          // pruned by retention still has its outcome visible here.
          // The `request_seq` in the store always points to the
          // earliest seq we observed (request if seen, outcome
          // otherwise), so the prompt anchors at the right place
          // even in the degraded case.
          const payload = evt.payload as { request_id?: unknown } | null;
          const reqId =
            payload && typeof payload === "object" && typeof payload.request_id === "string"
              ? payload.request_id
              : null;
          if (!reqId) return null;
          const approval = approvalsMap?.[reqId];
          if (!approval) return null;
          return (
            <StreamingSurfaceBoundary key={evt.event_id} surface="approval-prompt">
              <ApprovalPrompt
                runId={runId}
                approval={approval}
                onResolve={(rid, decision, reason) => {
                  if (onApprovalResolve) onApprovalResolve(rid, decision, reason);
                }}
              />
            </StreamingSurfaceBoundary>
          );
        }
        // RV2-W6: an outcome whose `request.created` was pruned still
        // gets rendered — anchor the prompt at the outcome's seq via
        // requestSeq (which the store sets to the originating seq if
        // seen, else the outcome's). Skip when the request row IS
        // present (the branch above already rendered it).
        if (
          evt.sdk_type === "request" &&
          (evt.kind === "approval.resolved" || evt.kind === "approval.failed")
        ) {
          const payload = evt.payload as { request_id?: unknown } | null;
          const reqId =
            payload && typeof payload === "object" && typeof payload.request_id === "string"
              ? payload.request_id
              : null;
          if (!reqId) return null;
          const approval = approvalsMap?.[reqId];
          if (!approval) return null;
          // If the originating request event is in the timeline, the
          // branch above renders this approval; skip here to avoid a
          // duplicate.
          const hasRequestEvt = events.some(
            (e) =>
              e.sdk_type === "request" &&
              e.kind === "request.created" &&
              (e.payload as { request_id?: unknown } | null)?.request_id === reqId,
          );
          if (hasRequestEvt) return null;
          return (
            <StreamingSurfaceBoundary key={evt.event_id} surface="approval-prompt">
              <ApprovalPrompt
                runId={runId}
                approval={approval}
                onResolve={(rid, decision, reason) => {
                  if (onApprovalResolve) onApprovalResolve(rid, decision, reason);
                }}
              />
            </StreamingSurfaceBoundary>
          );
        }
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
