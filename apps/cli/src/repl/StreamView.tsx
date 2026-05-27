import React, { memo, useMemo } from "react";
import { Box, Text } from "ink";
import { styles } from "../render/styles.js";
import type { ServerFrame } from "@harness/shared";
import { sanitizeTerminalText } from "../output/sanitize.js";
import { renderFileEdit } from "../render/diff.js";
import { normalizePath } from "../render/path.js";
import { renderMarkdown } from "../render/markdown.js";
import { formatToolCall } from "../render/tool-call.js";
import { formatToolCallLine } from "./ToolCallLine.js";
import { createTuiTheme, fg, hardWrapText, truncateMiddle, visibleLength, type TuiTheme } from "./theme.js";

const MAX_BUFFER_ITEMS = 5000;
const MAX_TEXT_LINES = 5000;
const MAX_TEXT_BYTES = 512 * 1024;

export type StreamItem =
  | { type: "user"; text: string; at: string }
  | { type: "assistant"; text: string }
  | { type: "thinking"; text: string; collapsed?: boolean }
  | { type: "tool"; callId: string; name: string; status: "running" | "completed" | "error" | "cancelled"; verb: string; primaryArg: string; secondaryDetail?: string; durationMs?: number; error?: string }
  | { type: "diff"; path: string; language?: string; before?: string; after?: string; unifiedDiff?: string }
  | { type: "approval"; requestId: string; description: string }
  | { type: "summary"; status: string; tokens: number | null; costMicros: number | null; durationMs: number | null }
  | { type: "system"; text: string }
  | { type: "error"; message: string };

export interface StreamBuffer {
  items: StreamItem[];
}

export function createStreamBuffer(): StreamBuffer {
  return { items: [] };
}

export function ingestStreamFrame(buffer: StreamBuffer, frame: ServerFrame, cwd: string = process.cwd()): StreamBuffer {
  const items = [...buffer.items];
  switch (frame.type) {
    case "sdk.assistant": {
      const delta = frame.event.payload.text_delta ?? "";
      const last = items.at(-1);
      if (last?.type === "assistant" && !frame.event.payload.is_replacement) {
        items[items.length - 1] = { type: "assistant", text: capStreamText(last.text + delta) };
      } else {
        items.push({ type: "assistant", text: capStreamText(delta) });
      }
      break;
    }
    case "sdk.thinking": {
      const delta = frame.event.payload.text_delta;
      const last = items.at(-1);
      if (last?.type === "thinking" && !frame.event.payload.is_replacement) {
        items[items.length - 1] = { ...last, text: capStreamText(last.text + delta) };
      } else {
        items.push({ type: "thinking", text: capStreamText(delta) });
      }
      break;
    }
    case "sdk.tool_call": {
      const payload = frame.event.payload;
      const summary = formatToolCall(payload.name, payload.args, cwd);
      const existingIndex = items.findIndex((item) => item.type === "tool" && item.callId === payload.call_id);
      const next: StreamItem = {
        type: "tool",
        callId: payload.call_id,
        name: payload.name,
        status: payload.status,
        verb: summary.verb,
        primaryArg: summary.primaryArg,
        ...(summary.secondaryDetail ? { secondaryDetail: summary.secondaryDetail } : {}),
        ...(payload.timing?.duration_ms !== undefined ? { durationMs: payload.timing.duration_ms } : {}),
        ...(payload.status === "error" ? { error: summarizeUnknown(payload.result) } : {}),
      };
      if (existingIndex >= 0) items[existingIndex] = next;
      else items.push(next);
      break;
    }
    case "derived.code_edit": {
      for (const edit of frame.event.payload.edits) {
        items.push({
          type: "diff",
          path: normalizePath(edit.path, cwd),
          ...(edit.language ? { language: edit.language } : {}),
          ...(edit.before !== undefined ? { before: edit.before } : {}),
          ...(edit.after !== undefined ? { after: edit.after } : {}),
          ...(edit.unifiedDiff !== undefined ? { unifiedDiff: edit.unifiedDiff } : {}),
        });
      }
      break;
    }
    case "sdk.request": {
      items.push({
        type: "approval",
        requestId: frame.event.payload.request_id,
        description: frame.event.payload.inferred_reason ?? "Agent requested approval",
      });
      break;
    }
    case "run.final_result": {
      const usage = frame.event.payload.usage;
      reconcileRunningTools(items, "completed");
      items.push({
        type: "summary",
        status: "FINISHED",
        tokens: sumTokens(usage.input_tokens, usage.output_tokens),
        costMicros: usage.cost_usd_micros,
        durationMs: frame.event.payload.duration_ms ?? null,
      });
      break;
    }
    case "run.interrupted": {
      reconcileRunningTools(items, "cancelled");
      items.push({ type: "summary", status: "CANCELLED", tokens: null, costMicros: null, durationMs: null });
      break;
    }
    case "error": {
      reconcileRunningTools(items, "completed");
      items.push({ type: "error", message: frame.message });
      break;
    }
    default:
      break;
  }
  return { items: capItems(items) };
}

export function renderStreamItems(items: readonly StreamItem[], width = 80): string {
  return items.map((item) => renderStreamItem(item, width)).filter((line) => line.length > 0).join("\n");
}

export function renderViewportLines(text: string, width: number, height: number, scrollOffset: number): string[] {
  const wrapped = hardWrapText(text, Math.max(10, width));
  const viewportHeight = Math.max(1, height);
  const maxOffset = Math.max(0, wrapped.length - viewportHeight);
  const offset = Math.min(Math.max(0, scrollOffset), maxOffset);
  return viewportLinesFromWrapped(wrapped, viewportHeight, offset);
}

export interface StreamViewportState {
  rendered: string;
  lines: string[];
  bodyHeight: number;
  maxOffset: number;
  effectiveOffset: number;
  showScrollIndicator: boolean;
  streamScrollActive: boolean;
}

export function computeStreamViewportState(
  items: readonly StreamItem[],
  width: number,
  height: number,
  scrollOffset: number,
  activeLabel?: string | undefined,
): StreamViewportState {
  const safeWidth = Math.max(12, width);
  const rendered = renderStreamItems(items, safeWidth);
  const wrapped = rendered.length > 0 ? hardWrapText(rendered, safeWidth) : [];
  const labelHeight = activeLabel ? 1 : 0;
  const bodyWithoutIndicator = Math.max(1, height - labelHeight);
  const maxWithoutIndicator = Math.max(0, wrapped.length - bodyWithoutIndicator);
  const requestedOffset = Math.max(0, scrollOffset);
  let showScrollIndicator = requestedOffset > 0 && maxWithoutIndicator > 0 && rendered.length > 0;
  let bodyHeight = Math.max(1, height - labelHeight - (showScrollIndicator ? 1 : 0));
  let maxOffset = Math.max(0, wrapped.length - bodyHeight);
  let effectiveOffset = Math.min(requestedOffset, maxOffset);
  showScrollIndicator = effectiveOffset > 0 && maxOffset > 0 && rendered.length > 0;
  bodyHeight = Math.max(1, height - labelHeight - (showScrollIndicator ? 1 : 0));
  maxOffset = Math.max(0, wrapped.length - bodyHeight);
  effectiveOffset = Math.min(requestedOffset, maxOffset);
  const lines = rendered.length > 0 ? viewportLinesFromWrapped(wrapped, bodyHeight, effectiveOffset) : [];
  return {
    rendered,
    lines,
    bodyHeight,
    maxOffset,
    effectiveOffset,
    showScrollIndicator,
    streamScrollActive: maxOffset > 0,
  };
}

export function maxStreamScrollOffset(items: readonly StreamItem[], width: number, height: number, activeLabel?: string | undefined): number {
  return computeStreamViewportState(items, width, height, Number.MAX_SAFE_INTEGER, activeLabel).maxOffset;
}

export function clampStreamScrollOffset(items: readonly StreamItem[], width: number, height: number, scrollOffset: number, activeLabel?: string | undefined): number {
  return computeStreamViewportState(items, width, height, scrollOffset, activeLabel).effectiveOffset;
}

function viewportLinesFromWrapped(wrapped: readonly string[], height: number, scrollOffset: number): string[] {
  const viewportHeight = Math.max(1, height);
  const maxOffset = Math.max(0, wrapped.length - viewportHeight);
  const offset = Math.min(Math.max(0, scrollOffset), maxOffset);
  const start = Math.max(0, wrapped.length - viewportHeight - offset);
  return wrapped.slice(start, start + viewportHeight);
}

export function formatScrollIndicator(scrollOffset: number, width: number): string {
  const safeWidth = Math.max(12, width);
  const text = safeWidth >= 48 ? `── ▼ ${scrollOffset} lines below · ↓ PgDn or Ctrl+G latest ──` : `▼ ${scrollOffset} below`;
  return truncateMiddle(text, safeWidth);
}

/**
 * Turn separator. With a timestamp it fills to `width` (── you · 14:32 ─────);
 * without one it is a short sub-label (── claude ──).
 */
export function formatTurnHeader(label: string, width: number, at?: string): string {
  if (at === undefined) return `── ${label} ──`;
  const prefix = `── ${label} · ${at} `;
  const fill = Math.max(0, Math.max(12, width) - visibleLength(prefix));
  return `${prefix}${"─".repeat(fill)}`;
}

export function computeActiveLabelSpacerHeight(visibleLineCount: number, bodyHeight: number): number {
  return Math.max(0, Math.max(1, bodyHeight) - Math.max(1, visibleLineCount));
}

export interface ActiveLabelSegment {
  text: string;
  color?: string;
}

export interface StreamViewProps {
  items: readonly StreamItem[];
  height?: number;
  width?: number;
  scrollOffset?: number;
  activeLabel?: string | undefined;
  activeLabelSegments?: readonly ActiveLabelSegment[] | undefined;
  viewportState?: StreamViewportState;
  theme?: TuiTheme;
}

export const StreamView = memo(function StreamView({ items, height, width = process.stdout.columns ?? 80, scrollOffset = 0, activeLabel, activeLabelSegments, viewportState, theme = createTuiTheme() }: StreamViewProps) {
  const safeWidth = Math.max(12, width);
  const rendered = useMemo(() => renderStreamItems(items, safeWidth), [items, safeWidth]);
  const viewport = useMemo(
    () => height === undefined
      ? undefined
      : (viewportState ?? computeStreamViewportState(items, safeWidth, height, scrollOffset, activeLabel)),
    [activeLabel, height, items, safeWidth, scrollOffset, viewportState],
  );
  if (height === undefined) {
    return (
      <Box flexDirection="column">
        <Text>{rendered}</Text>
      </Box>
    );
  }
  const lines = viewport?.lines ?? [];
  const bodyHeight = viewport?.bodyHeight ?? Math.max(1, height - (activeLabel ? 1 : 0));
  const effectiveOffset = viewport?.effectiveOffset ?? 0;
  const showScrollIndicator = viewport?.showScrollIndicator ?? false;
  const visibleLineCount = lines.length === 0 ? 1 : lines.length;
  const activeLabelSpacerHeight = activeLabel ? computeActiveLabelSpacerHeight(visibleLineCount, bodyHeight) : 0;
  const indicatorText = formatScrollIndicator(effectiveOffset, safeWidth);
  return (
    <Box flexDirection="column" height={height}>
      {lines.length === 0 ? <Text {...fg(theme.muted)}>No messages yet. Start with a prompt, @file, or /command.</Text> : lines.map((line, index) => <Text key={`${index}:${line}`}>{line}</Text>)}
      {activeLabelSpacerHeight > 0 ? <Box height={activeLabelSpacerHeight} /> : null}
      {showScrollIndicator ? <Text {...fg(theme.muted)}>{indicatorText}</Text> : null}
      {activeLabel ? renderActiveLabel(activeLabel, activeLabelSegments, theme) : null}
    </Box>
  );
});

function renderActiveLabel(label: string, segments: readonly ActiveLabelSegment[] | undefined, theme: TuiTheme): React.ReactElement {
  if (segments && segments.length > 0 && segments.map((segment) => segment.text).join("") === label) {
    return (
      <Text>
        {segments.map((segment, index) => (
          <Text key={`${index}:${segment.text}`} {...fg(segment.color)}>
            {segment.text}
          </Text>
        ))}
      </Text>
    );
  }
  return <Text {...fg(theme.brand)}>{label}</Text>;
}

function renderStreamItem(item: StreamItem, width: number): string {
  switch (item.type) {
    case "user":
      return `${styles.brand(formatTurnHeader("you", width, item.at))}\n${styles.user(sanitizeTerminalText(item.text))}`;
    case "assistant":
      return `${styles.muted(formatTurnHeader("claude", width))}\n${renderMarkdown(item.text)}`;
    case "thinking":
      return styles.thinking(`◐ Thinking...\n  ${sanitizeTerminalText(item.text)}`);
    case "tool":
      return formatToolCallLine(item);
    case "diff":
      return renderFileEdit(item);
    case "approval":
      return styles.approval(`⚠ Approval required: ${sanitizeTerminalText(item.description)} [y]es / [n]o / [a]lways`);
    case "summary":
      return styles.muted(renderSummary(item));
    case "system":
      return styles.system(sanitizeTerminalText(item.text));
    case "error":
      return styles.error(sanitizeTerminalText(item.message));
  }
}

function renderSummary(item: Extract<StreamItem, { type: "summary" }>): string {
  if (item.status === "FINISHED") return "";
  return `── ${item.status.toLowerCase()} ──`;
}

function summarizeUnknown(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = sanitizeTerminalText(typeof value === "string" ? value : JSON.stringify(value));
  if (!text) return "";
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

function sumTokens(input: number | null, output: number | null): number | null {
  if (input === null && output === null) return null;
  return (input ?? 0) + (output ?? 0);
}

// Running tools stay visible in the transcript so parallel task/subagent launches
// are observable before their completed frames arrive. Terminal run frames still
// freeze any dangling running tools to keep replay and final output coherent.
function reconcileRunningTools(items: StreamItem[], status: "completed" | "cancelled"): void {
  for (let index = 0; index < items.length; index += 1) {
    const candidate = items[index];
    if (candidate?.type === "tool" && candidate.status === "running") items[index] = { ...candidate, status };
  }
}

function capItems(items: StreamItem[]): StreamItem[] {
  if (items.length <= MAX_BUFFER_ITEMS) return items;
  return items.slice(items.length - MAX_BUFFER_ITEMS);
}

function capStreamText(text: string): string {
  let next = text.length <= MAX_TEXT_BYTES ? text : text.slice(text.length - MAX_TEXT_BYTES);
  const lines = next.split("\n");
  if (lines.length > MAX_TEXT_LINES) next = lines.slice(lines.length - MAX_TEXT_LINES).join("\n");
  return next;
}
