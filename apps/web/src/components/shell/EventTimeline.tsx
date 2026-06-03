import { useMemo } from "react";
import { useRunStore, type CanonicalRunEvent } from "../../state/run-store.js";
import { buildTimelineSegments } from "../../lib/timeline-segments.js";
import { UserMessage } from "../timeline/UserMessage.js";
import { StreamingMarkdown } from "../streaming/StreamingMarkdown.js";
import { ThinkingTrace } from "../streaming/ThinkingTrace.js";
import { ToolCallLane } from "../streaming/ToolCallLane.js";
import { SystemBanner } from "../streaming/SystemBanner.js";
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

function requestIdFromEvent(evt: CanonicalRunEvent): string | null {
  const payload = evt.payload as { request_id?: unknown } | null;
  return payload && typeof payload === "object" && typeof payload.request_id === "string"
    ? payload.request_id
    : null;
}

function hasRequestEvent(
  chunks: ReadonlyArray<ReadonlyArray<CanonicalRunEvent>>,
  reqId: string,
): boolean {
  for (const chunk of chunks) {
    for (const event of chunk) {
      if (
        event.sdk_type === "request" &&
        event.kind === "request.created" &&
        requestIdFromEvent(event) === reqId
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Phase 09 timeline. Events remain the canonical ordering source. Related
 * deltas render through streaming surfaces scoped to contiguous seq blocks so
 * assistant prose, thinking traces, and tool calls appear in event order.
 * Live and replay both feed the same run-store projections.
 */
export function EventTimeline({ runId, onApprovalResolve }: EventTimelineProps) {
  const eventChunks = useRunStore((s) =>
    runId ? (s.eventsByRunId[runId]?.eventChunks ?? null) : null,
  );
  const approvalsMap = useRunStore((s) =>
    runId ? (s.eventsByRunId[runId]?.approvalsByRequestId ?? null) : null,
  );
  const { runStalled } = useRunHealth(runId);
  const segments = useMemo(
    () => (eventChunks ? buildTimelineSegments(eventChunks) : []),
    [eventChunks],
  );
  const firstCodeEditKey = useMemo(
    () => segments.find((segment) => segment.type === "code_edit")?.key ?? null,
    [segments],
  );

  if (!runId) {
    return (
      <div className="px-2 py-6 text-md text-text-tertiary">
        Select a run or send a prompt to start a new one.
      </div>
    );
  }
  if (!eventChunks || eventChunks.length === 0) {
    return (
      <div className="px-2 py-6 text-md text-text-tertiary">No messages yet. Start a run.</div>
    );
  }

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
      {segments.map((segment) => {
        switch (segment.type) {
          case "system":
            return (
              <StreamingSurfaceBoundary key={segment.key} surface="system-banner">
                <SystemBanner event={segment.event} />
              </StreamingSurfaceBoundary>
            );
          case "user":
            return <UserMessage key={segment.key} event={segment.event} />;
          case "thinking":
            return (
              <StreamingSurfaceBoundary key={segment.key} surface="thinking-trace">
                <ThinkingTrace runId={runId} startSeq={segment.startSeq} endSeq={segment.endSeq} />
              </StreamingSurfaceBoundary>
            );
          case "assistant":
            return (
              <div key={segment.key} className="agent-message">
                <div className="agent-message__head">
                  <span className="agent-message__glyph mono">A</span>
                  <span className="font-semibold text-accent-primary">Orrery</span>
                  <span className="mono text-xs text-text-tertiary">
                    {new Date(segment.anchorEvent.occurred_at).toLocaleTimeString()}
                  </span>
                </div>
                <StreamingSurfaceBoundary surface="assistant-markdown">
                  <StreamingMarkdown
                    runId={runId}
                    source="assistant"
                    startSeq={segment.startSeq}
                    endSeq={segment.endSeq}
                  />
                </StreamingSurfaceBoundary>
              </div>
            );
          case "tool_call_group":
            return (
              <StreamingSurfaceBoundary key={segment.key} surface="tool-calls">
                <ToolCallLane runId={runId} callIds={segment.callIds} />
              </StreamingSurfaceBoundary>
            );
          case "code_edit":
            if (segment.key !== firstCodeEditKey) return null;
            return (
              <StreamingSurfaceBoundary key={segment.key} surface="code-edits">
                <CodeEditPreviewPanel runId={runId} />
              </StreamingSurfaceBoundary>
            );
          case "approval": {
            const evt = segment.event;
            const reqId = requestIdFromEvent(evt);
            if (!reqId) return null;
            const approval = approvalsMap?.[reqId];
            if (!approval) return null;
            if (
              (evt.kind === "approval.resolved" || evt.kind === "approval.failed") &&
              hasRequestEvent(eventChunks, reqId)
            ) {
              return null;
            }
            return (
              <StreamingSurfaceBoundary key={segment.key} surface="approval-prompt">
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
          case "fallback":
            return (
              <div key={segment.key} className="my-1 text-xs text-text-tertiary">
                <span className="mono">[{segment.event.kind}]</span>
                <span className="ml-2">{segment.event.occurred_at}</span>
              </div>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
