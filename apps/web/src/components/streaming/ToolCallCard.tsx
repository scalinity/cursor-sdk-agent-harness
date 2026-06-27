import { useState } from "react";
import { useAutoCollapse } from "../../hooks/useAutoCollapse.js";
import { cn } from "../../lib/cn.js";
import { safeJsonString } from "../../lib/safe-payload.js";
import type { ToolCallProjection } from "../../lib/tool-call-projection.js";
import { useRunStore } from "../../state/run-store.js";
import { useUiStore } from "../../state/ui-store.js";
import { CodeEditPreview } from "./CodeEditPreview.js";
import { JsonInspector } from "./JsonInspector.js";
import { StreamingSurfaceBoundary } from "./StreamingSurfaceBoundary.js";

export interface ToolCallCardProps {
  call: ToolCallProjection;
  runId: string;
  /**
   * Phase 13 — when true, a pending approval request is keyed to this
   * tool call's `call_id`. ToolCallLane derives the bit from
   * `approvalsByRequestId` so cards don't take a store dep of their own.
   */
  awaitingApproval?: boolean;
  /**
   * Phase 13 — stall thresholds. ToolCallLane computes these from
   * `useRunHealth` and passes them down so each card stays presentational.
   */
  stillRunning?: boolean;
  longRunning?: boolean;
}

type ToolIcon = "read" | "write" | "run" | "grep" | "web" | "default";

function iconForTool(name: string): ToolIcon {
  const lower = name.toLowerCase();
  if (/read_file|read|view/.test(lower)) return "read";
  if (/edit_file|write_file|create_file|edit|write/.test(lower)) return "write";
  if (/shell|bash|run/.test(lower)) return "run";
  if (/grep|search|glob/.test(lower)) return "grep";
  if (/web_fetch|fetch|browser|web/.test(lower)) return "web";
  return "default";
}

const ICON_GLYPH: Record<ToolIcon, string> = {
  read: "doc",
  write: "pen",
  run: ">_",
  grep: "src",
  web: "web",
  default: "box",
};

function formatMs(ms: number | undefined): string {
  if (ms === undefined) return "writing...";
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(2)}s`;
}

function summarizeArgs(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  return Object.entries(value as Record<string, unknown>)
    .slice(0, 3)
    .map(([key, item]) => {
      const rendered = typeof item === "string" ? JSON.stringify(item) : safeJsonString(item);
      return `${key}: ${rendered}`;
    })
    .join(" · ");
}

function resultPreview(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return safeJsonString(value);
}

function byteSummary(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  const lines = record.linesRead ?? record.linesCreated ?? record.line_count;
  const fileSize = record.fileSize ?? record.byteCount ?? record.bytes;
  if (typeof lines === "number") parts.push(`read ${lines.toString()} lines`);
  if (typeof fileSize === "number") parts.push(`${(fileSize / 1024).toFixed(1)} KB`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function hasContractConfirmation(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return typeof (value as Record<string, unknown>).contract === "string";
}

export function ToolCallCard({
  call,
  runId,
  awaitingApproval = false,
  stillRunning = false,
  longRunning = false,
}: ToolCallCardProps) {
  const [pinned, setPinned] = useState(false);
  const codeEditEvent = useRunStore((s) =>
    s.eventsByRunId[runId]?.codeEditEventBySourceCallId[call.callId] ?? null,
  );
  const selectCodeEditEvent = useUiStore((s) => s.selectCodeEditEvent);
  const { collapsed, setCollapsed } = useAutoCollapse({ status: call.status, pinned });
  const icon = iconForTool(call.name);
  const preview = resultPreview(call.result);
  const summary = byteSummary(call.result);
  const contractConfirmed = hasContractConfirmation(call.result);
  const statusLabel = formatMs(call.durationMs);

  return (
    <div className={cn("tool", collapsed ? "tool--collapsed" : null, `tool--${call.status}`)}>
      <div className="tool-head">
        <span className={cn("tool-icon", `tool-icon--${icon}`)} aria-hidden="true">
          {ICON_GLYPH[icon]}
        </span>
        <span className="name">{call.name}</span>
        <span className="arg">{summarizeArgs(call.args)}</span>
        <span className="ms">{statusLabel}</span>
        <span className={cn("tool-state", `tool-state--${call.status}`)}>{call.status}</span>
        {awaitingApproval ? (
          <span
            className="ml-2 inline-flex items-center rounded-sm border border-warning bg-surface-2 px-1.5 py-0.5 text-2xs text-warning"
            title="Approval requested for this tool call"
          >
            awaiting approval
          </span>
        ) : null}
        {stillRunning && call.status === "running" ? (
          <span
            className={cn(
              "ml-2 inline-flex items-center rounded-sm border px-1.5 py-0.5 text-2xs",
              longRunning
                ? "border-danger bg-surface-2 text-danger"
                : "border-warning bg-surface-2 text-warning",
            )}
            title={longRunning ? "Long-running tool (>2 min)" : "Still running (>30s)"}
          >
            {longRunning ? "long-running" : "still running"}
          </span>
        ) : null}
      </div>
      {!collapsed ? (
        <div className="tool-body">
          {call.status === "error" ? (
            <div className="tool-error">
              {call.errorMessage ?? "Tool call failed."} Check args/result details below.
            </div>
          ) : null}
          {preview ? <pre className="tool-output mono">{preview}</pre> : null}
          <div className="tool-inspectors">
            {call.args !== undefined || call.largePayloadRefs?.argsEventUrl ? (
              <StreamingSurfaceBoundary surface={`tool-args-${call.callId}`}>
                <JsonInspector
                  label="args"
                  value={call.args}
                  payloadRef={
                    call.args === undefined && call.largePayloadRefs?.argsEventUrl
                      ? { url: call.largePayloadRefs.argsEventUrl }
                      : undefined
                  }
                />
              </StreamingSurfaceBoundary>
            ) : null}
            {call.result !== undefined || call.largePayloadRefs?.resultEventUrl ? (
              <StreamingSurfaceBoundary surface={`tool-result-${call.callId}`}>
                <JsonInspector
                  label="result"
                  value={call.result}
                  payloadRef={
                    call.result === undefined && call.largePayloadRefs?.resultEventUrl
                      ? { url: call.largePayloadRefs.resultEventUrl }
                      : undefined
                  }
                />
              </StreamingSurfaceBoundary>
            ) : null}
            {call.largePayloadRefs?.rawEventUrl ? (
              <StreamingSurfaceBoundary surface={`tool-raw-${call.callId}`}>
                <JsonInspector label="raw" payloadRef={{ url: call.largePayloadRefs.rawEventUrl }} />
              </StreamingSurfaceBoundary>
            ) : null}
          </div>
          {codeEditEvent ? (
            <div className="tool-code-preview">
              <div className="tool-code-preview__head">
                <span>Code edit preview</span>
                <button type="button" onClick={() => selectCodeEditEvent(runId, codeEditEvent.event_id)}>
                  view full
                </button>
              </div>
              <CodeEditPreview runId={runId} eventId={codeEditEvent.event_id} compact />
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="tool-foot">
        <button type="button" onClick={() => setPinned((value) => !value)}>
          {pinned ? "pinned" : "pin"}
        </button>
        {collapsed ? <button type="button" onClick={() => setCollapsed(false)}>expand</button> : null}
        {call.truncated?.args ? <span>args truncated</span> : null}
        {call.truncated?.result ? <span>result truncated</span> : null}
        {summary ? <span>{summary}</span> : null}
        {contractConfirmed ? <span>contract confirmed</span> : null}
      </div>
    </div>
  );
}
