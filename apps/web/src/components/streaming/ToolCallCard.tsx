import { useMemo, useState } from "react";
import { useAutoCollapse } from "../../hooks/useAutoCollapse.js";
import { findCodeEditEventForCall } from "../../lib/code-edit-events.js";
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

function iconGlyph(icon: ToolIcon): string {
  if (icon === "read") return "doc";
  if (icon === "write") return "pen";
  if (icon === "run") return ">_";
  if (icon === "grep") return "src";
  if (icon === "web") return "web";
  return "box";
}

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

export function ToolCallCard({ call, runId }: ToolCallCardProps) {
  const [pinned, setPinned] = useState(false);
  const events = useRunStore((s) => s.eventsByRunId[runId]?.events ?? []);
  const selectCodeEditEvent = useUiStore((s) => s.selectCodeEditEvent);
  const codeEditEvent = useMemo(() => findCodeEditEventForCall(events, call.callId), [events, call.callId]);
  const { collapsed, setCollapsed } = useAutoCollapse({ status: call.status, pinned });
  const icon = iconForTool(call.name);
  const preview = resultPreview(call.result);
  const summary = byteSummary(call.result);
  const contractConfirmed = hasContractConfirmation(call.result);
  const statusLabel = call.status === "running" ? formatMs(call.durationMs) : formatMs(call.durationMs);

  return (
    <div className={cn("tool", collapsed ? "tool--collapsed" : null, `tool--${call.status}`)}>
      <div className="tool-head">
        <span className={cn("tool-icon", `tool-icon--${icon}`)} aria-hidden="true">
          {iconGlyph(icon)}
        </span>
        <span className="name">{call.name}</span>
        <span className="arg">{summarizeArgs(call.args)}</span>
        <span className="ms">{statusLabel}</span>
        <span className={cn("tool-state", `tool-state--${call.status}`)}>{call.status}</span>
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
