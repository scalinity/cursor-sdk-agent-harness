import React, { memo, useMemo } from "react";
import { Box, Text } from "ink";
import { styles } from "../render/styles.js";
import type { ServerFrame } from "@harness/shared";
import { sanitizeTerminalText } from "../output/sanitize.js";
import { formatMicros } from "../output/table.js";
import { renderFileEdit } from "../render/diff.js";
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
  | { type: "tool"; callId: string; name: string; status: "running" | "completed" | "error"; verb: string; primaryArg: string; secondaryDetail?: string; durationMs?: number; error?: string }
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
          path: edit.path,
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
      items.push({ type: "summary", status: "CANCELLED", tokens: null, costMicros: null, durationMs: null });
      break;
    }
    case "error": {
      items.push({ type: "error", message: frame.message });
      break;
    }
    default:
      break;
  }
  return { items: capItems(items) };
}

export function renderStreamItems(items: readonly StreamItem[], width = 80): string {
  return items.map((item) => renderStreamItem(item, width)).join("\n");
}

export function renderViewportLines(text: string, width: number, height: number, scrollOffset: number): string[] {
  const wrapped = hardWrapText(text, Math.max(10, width));
  const viewportHeight = Math.max(1, height);
  const maxOffset = Math.max(0, wrapped.length - viewportHeight);
  const offset = Math.min(Math.max(0, scrollOffset), maxOffset);
  const start = Math.max(0, wrapped.length - viewportHeight - offset);
  return wrapped.slice(start, start + viewportHeight);
}

export function clampStreamScrollOffset(items: readonly StreamItem[], width: number, height: number, scrollOffset: number, activeLabel?: string | undefined): number {
  const rendered = renderStreamItems(items, Math.max(12, width));
  const labelHeight = activeLabel ? 1 : 0;
  const indicatorHeight = scrollOffset > 0 && rendered.length > 0 ? 1 : 0;
  const bodyHeight = Math.max(1, height - labelHeight - indicatorHeight);
  const wrappedLineCount = rendered.length > 0 ? hardWrapText(rendered, Math.max(12, width)).length : 0;
  const maxOffset = Math.max(0, wrappedLineCount - Math.max(1, bodyHeight));
  return Math.min(Math.max(0, scrollOffset), maxOffset);
}

export function formatScrollIndicator(scrollOffset: number, width: number): string {
  const safeWidth = Math.max(12, width);
  const text = safeWidth >= 48 ? `── ▼ ${scrollOffset} lines below · Shift+↓ PgDn ──` : `▼ ${scrollOffset} below`;
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

export interface StreamViewProps {
  items: readonly StreamItem[];
  height?: number;
  width?: number;
  scrollOffset?: number;
  activeLabel?: string | undefined;
  theme?: TuiTheme;
}

export const StreamView = memo(function StreamView({ items, height, width = process.stdout.columns ?? 80, scrollOffset = 0, activeLabel, theme = createTuiTheme() }: StreamViewProps) {
  const safeWidth = Math.max(12, width);
  const rendered = useMemo(() => renderStreamItems(items, safeWidth), [items, safeWidth]);
  if (height === undefined) {
    return (
      <Box flexDirection="column">
        <Text>{rendered}</Text>
      </Box>
    );
  }
  const labelHeight = activeLabel ? 1 : 0;
  const showScrollIndicator = scrollOffset > 0 && rendered.length > 0;
  const indicatorHeight = showScrollIndicator ? 1 : 0;
  const bodyHeight = Math.max(1, height - labelHeight - indicatorHeight);
  const lines = useMemo(() => rendered.length > 0 ? renderViewportLines(rendered, safeWidth, bodyHeight, scrollOffset) : [], [bodyHeight, rendered, scrollOffset, safeWidth]);
  const indicatorText = formatScrollIndicator(scrollOffset, safeWidth);
  return (
    <Box flexDirection="column" height={height}>
      {lines.length === 0 ? <Text {...fg(theme.muted)}>No messages yet. Start with a prompt, @file, or /command.</Text> : lines.map((line, index) => <Text key={`${index}:${line}`}>{line}</Text>)}
      {activeLabel ? <Text {...fg(theme.accent)}>{activeLabel}</Text> : null}
      {showScrollIndicator ? <Text {...fg(theme.muted)}>{indicatorText}</Text> : null}
    </Box>
  );
});

function renderStreamItem(item: StreamItem, width: number): string {
  switch (item.type) {
    case "user":
      return `${styles.accent(formatTurnHeader("you", width, item.at))}\n${styles.user(sanitizeTerminalText(item.text))}`;
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
  if (item.tokens === null && item.costMicros === null && item.durationMs === null) {
    return `── ${item.status.toLowerCase()} ──`;
  }
  const tokens = item.tokens === null ? "tokens unavailable" : `${item.tokens.toLocaleString("en-US")} tokens`;
  const cost = formatMicros(item.costMicros);
  const duration = item.durationMs === null ? "duration n/a" : `${(item.durationMs / 1000).toFixed(1)}s`;
  const status = item.status === "FINISHED" ? "" : ` · ${item.status.toLowerCase()}`;
  return `── ${tokens} · turn ${cost} · ${duration}${status} ──`;
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
