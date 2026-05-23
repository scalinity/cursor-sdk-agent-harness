import { useRunStore } from "../../state/run-store.js";
import { UserMessage } from "../timeline/UserMessage.js";
import { StreamingMarkdown } from "../streaming/StreamingMarkdown.js";
import { ThinkingTrace } from "../streaming/ThinkingTrace.js";
import { ToolCallLane } from "../streaming/ToolCallLane.js";
import { SystemBanner } from "../streaming/SystemBanner.js";
import { RunStatusPill } from "../streaming/RunStatusPill.js";
import { StreamingSurfaceBoundary } from "../streaming/StreamingSurfaceBoundary.js";
import { CodeEditPreviewPanel } from "../streaming/CodeEditPreviewPanel.js";

export interface EventTimelineProps {
  runId: string | null;
}

/**
 * Phase 09 timeline. Events remain the canonical ordering source, but related
 * deltas are rendered through aggregate streaming surfaces: one assistant
 * markdown stream, one thinking trace, grouped tool-call lanes, code-edit
 * preview placeholders, and status/usage badges. Live and replay both feed the
 * same run-store projections, so surfaces avoid per-token React commits while
 * preserving event order for surrounding markers.
 */
export function EventTimeline({ runId }: EventTimelineProps) {
  const events = useRunStore((s) =>
    runId ? (s.eventsByRunId[runId]?.events ?? null) : null,
  );

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
