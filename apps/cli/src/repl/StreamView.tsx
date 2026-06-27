import React, { memo, useMemo } from "react";
import { Box, Text } from "ink";
import { styles } from "../render/styles.js";
import type { ServerFrame, SubagentToolCallSummary } from "@harness/shared";
import { isRunStatusTerminalFrame } from "../client/ws.js";
import { sanitizeTerminalText } from "../output/sanitize.js";
import { renderFileEdit } from "../render/diff.js";
import { normalizePath } from "../render/path.js";
import { renderMarkdown } from "../render/markdown.js";
import { formatToolCall } from "../render/tool-call.js";
import { formatToolCallLine } from "./ToolCallLine.js";
import { glyph } from "./glyphs.js";
import { createTuiTheme, fg, hardWrapText, truncateMiddle, visibleLength, type TuiTheme } from "./theme.js";
import { formatDuration, formatMicros } from "../output/table.js";

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
  | { type: "summary"; status: string; tokens: number | null; tokensPartial: boolean; costMicros: number | null; costUnavailable: boolean; durationMs: number | null }
  | { type: "task"; status: string; text: string }
  | { type: "subagent"; childRunId: string; sourceCallId: string; name: string; phase: "spawned" | "completed"; status: string; toolCalls?: SubagentToolCallSummary[] }
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
    case "sdk.status": {
      if (isRunStatusTerminalFrame(frame)) {
        reconcileRunningTools(items, frame.event.payload.status === "CANCELLED" ? "cancelled" : "completed");
      }
      break;
    }
    case "sdk.task": {
      const status = frame.event.payload.status ?? "updated";
      const text = frame.event.payload.text ?? "";
      if (status.length > 0 || text.length > 0) items.push({ type: "task", status, text });
      break;
    }
    case "subagent_spawned": {
      const payload = frame.event.payload;
      upsertSubagentItem(items, {
        type: "subagent",
        childRunId: payload.child_run_id,
        sourceCallId: payload.source_call_id,
        name: payload.subagent_name,
        phase: "spawned",
        status: payload.status ?? "RUNNING",
      });
      break;
    }
    case "subagent_completed": {
      const payload = frame.event.payload;
      upsertSubagentItem(items, {
        type: "subagent",
        childRunId: payload.child_run_id,
        sourceCallId: payload.source_call_id,
        name: payload.subagent_name,
        phase: "completed",
        status: payload.status,
        ...(payload.tool_calls && payload.tool_calls.length > 0 ? { toolCalls: payload.tool_calls } : {}),
      });
      break;
    }
    case "run.final_result": {
      const usage = frame.event.payload.usage;
      const tokenTotal = summarizeUsageTokens(usage);
      reconcileRunningTools(items, "completed");
      items.push({
        type: "summary",
        status: "FINISHED",
        tokens: tokenTotal.tokens,
        tokensPartial: tokenTotal.partial,
        costMicros: usage.usage_source === "unavailable" ? null : usage.cost_usd_micros,
        costUnavailable: usage.usage_source === "unavailable" || usage.cost_usd_micros === null,
        durationMs: frame.event.payload.duration_ms ?? null,
      });
      break;
    }
    case "run.interrupted": {
      reconcileRunningTools(items, "cancelled");
      items.push({ type: "summary", status: "CANCELLED", tokens: null, tokensPartial: false, costMicros: null, costUnavailable: true, durationMs: null });
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
  const lines: string[] = [];
  let previousBlock: StreamBlock | null = null;
  for (const item of items) {
    const block = classifyStreamBlock(item);
    const rendered = renderStreamItem(item, width);
    if (rendered.length === 0) continue;
    if (previousBlock !== null && shouldInsertBlockGap(previousBlock, block)) {
      lines.push("");
    }
    lines.push(rendered);
    previousBlock = block;
  }
  return lines.join("\n");
}

type StreamBlock = "user" | "assistant" | "thinking" | "tool-sequence" | "subagent-card" | "meta";

function classifyStreamBlock(item: StreamItem): StreamBlock {
  if (item.type === "user") return "user";
  if (item.type === "assistant") return "assistant";
  if (item.type === "thinking") return "thinking";
  if (item.type === "subagent") return "subagent-card";
  if (item.type === "tool" || item.type === "task" || item.type === "diff") return "tool-sequence";
  return "meta";
}

function shouldInsertBlockGap(current: StreamBlock, next: StreamBlock): boolean {
  if (current === "tool-sequence" && next === "tool-sequence") return false;
  return current !== next;
}

export function renderViewportLines(text: string, width: number, height: number, scrollOffset: number): string[] {
  // viewportLinesFromWrapped clamps the offset itself, so no pre-clamping here.
  return viewportLinesFromWrapped(hardWrapText(text, Math.max(10, width)), height, scrollOffset);
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
 * without one it is a short sub-label (── Gumbo ──).
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
  return <Text {...fg(theme.state?.running)}>{label}</Text>;
}

function renderStreamItem(item: StreamItem, width: number): string {
  switch (item.type) {
    case "user":
      return `${styles.brand(formatTurnHeader("you", width, item.at))}\n${styles.user(sanitizeTerminalText(item.text))}`;
    case "assistant":
      return `${styles.brand(formatTurnHeader("Gumbo", width))}\n${styles.muted(renderMarkdown(item.text))}`;
    case "thinking":
      return styles.thinking(`${glyph.thinking} Thinking...\n  ${sanitizeTerminalText(item.text)}`);
    case "tool":
      return formatToolCallLine(item);
    case "task":
      return formatTaskLine(item);
    case "subagent":
      return formatSubagentCard(item, width);
    case "diff":
      return renderFileEdit(item);
    case "approval":
      return styles.approval(`Approval required: ${sanitizeTerminalText(item.description)} [y]es / [n]o / [a]lways`);
    case "summary":
      return styles.muted(renderSummary(item));
    case "system":
      return styles.system(sanitizeTerminalText(item.text));
    case "error":
      return styles.error(sanitizeTerminalText(item.message));
  }
}

function renderSummary(item: Extract<StreamItem, { type: "summary" }>): string {
  if (item.status !== "FINISHED") return `── ${item.status.toLowerCase()} ──`;
  const parts = [formatTurnTokens(item), formatTurnCost(item)];
  if (item.durationMs !== null) parts.push(formatDuration(item.durationMs));
  return `── ${parts.join(" · ")} ──`;
}

function formatTaskLine(item: Extract<StreamItem, { type: "task" }>): string {
  const status = cleanInline(item.status) || "updated";
  const text = cleanInline(item.text);
  return styles.tool(`task ${status}${text ? ` ${text}` : ""}`);
}

function formatSubagentCard(item: Extract<StreamItem, { type: "subagent" }>, width: number): string {
  const name = cleanInline(item.name) || "unspecified";
  const isSpawned = item.phase === "spawned";
  const isError = item.status === "ERROR";
  const isMuted = item.status === "CANCELLED" || item.status === "EXPIRED";

  const terminal = isSpawned ? "spawned" : formatSubagentStatus(item.status);
  const statusGlyph = isSpawned ? glyph.running : isError ? glyph.failed : isMuted ? glyph.paused : glyph.done;

  const border = isMuted ? styles.muted : isSpawned ? styles.glyphRun : isError ? styles.glyphErr : styles.glyphOk;
  const nameStyle = isMuted ? styles.muted : styles.subagentName;
  const statusStyle = border;

  const safeWidth = Math.max(30, width);

  const topLabel = `╭─ ${glyph.agent} subagent `;
  const topFill = Math.max(0, safeWidth - topLabel.length - 1);
  const topLine = border(`${topLabel}${"─".repeat(topFill)}╮`);

  const statusPill = `${statusGlyph} ${terminal}`;
  const innerWidth = safeWidth - 5;
  const maxNameWidth = Math.max(1, innerWidth - statusPill.length - 1);
  const displayName = name.length > maxNameWidth ? truncateMiddle(name, maxNameWidth) : name;
  const gap = Math.max(1, innerWidth - displayName.length - statusPill.length);
  const bodyLine = `${border("│")}  ${nameStyle(displayName)}${" ".repeat(gap)}${statusStyle(statusPill)} ${border("│")}`;

  const toolLines = formatSubagentToolLines(item.toolCalls ?? [], innerWidth, border, isMuted);

  const bottomFill = Math.max(0, safeWidth - 2);
  const bottomLine = border(`╰${"─".repeat(bottomFill)}╯`);

  return [topLine, bodyLine, ...toolLines, bottomLine].join("\n");
}

// The SDK only surfaces a sub-agent's tool calls in the completed `task`
// result (never live), so these lines appear once the card flips to a
// terminal status — filling what was previously an empty box.
const MAX_SUBAGENT_TOOL_LINES = 12;

function formatSubagentToolLines(
  toolCalls: readonly SubagentToolCallSummary[],
  innerWidth: number,
  border: (text: string) => string,
  isMuted: boolean,
): string[] {
  if (toolCalls.length === 0) return [];
  const labelWidth = Math.max(1, innerWidth - 2);
  const visible = toolCalls.slice(0, MAX_SUBAGENT_TOOL_LINES);
  const lines = visible.map((tc) => {
    const glyphChar = tc.ok ? glyph.done : glyph.failed;
    const glyphStyle = isMuted ? styles.muted : tc.ok ? styles.glyphOk : styles.glyphErr;
    const labelStyle = isMuted ? styles.muted : styles.tool;
    const label = cleanInline(tc.detail ? `${tc.name} ${tc.detail}` : tc.name) || tc.name;
    const field = truncateMiddle(label, labelWidth).padEnd(labelWidth, " ");
    return `${border("│")}  ${glyphStyle(glyphChar)} ${labelStyle(field)} ${border("│")}`;
  });
  const overflow = toolCalls.length - visible.length;
  if (overflow > 0) {
    const field = `… +${overflow} more (${toolCalls.length} total)`.slice(0, innerWidth).padEnd(innerWidth, " ");
    lines.push(`${border("│")}  ${styles.muted(field)} ${border("│")}`);
  }
  return lines;
}

function formatSubagentStatus(status: string): string {
  switch (status) {
    case "FINISHED":
      return "finished";
    case "ERROR":
      return "error";
    case "CANCELLED":
      return "cancelled";
    case "EXPIRED":
      return "expired";
    default:
      return cleanInline(status).toLowerCase() || "completed";
  }
}

function cleanInline(value: string): string {
  return sanitizeTerminalText(value).replace(/\s+/g, " ").trim();
}

function upsertSubagentItem(items: StreamItem[], next: Extract<StreamItem, { type: "subagent" }>): void {
  const existingIndex = items.findIndex((item) => item.type === "subagent" && item.childRunId === next.childRunId && item.phase === next.phase);
  if (existingIndex >= 0) items[existingIndex] = next;
  else items.push(next);
}

function formatTurnTokens(item: Extract<StreamItem, { type: "summary" }>): string {
  if (item.tokens === null) return "tokens unavailable";
  const value = `${item.tokens.toLocaleString("en-US")} tok`;
  return item.tokensPartial ? `partial ${value}` : value;
}

function formatTurnCost(item: Extract<StreamItem, { type: "summary" }>): string {
  if (item.costUnavailable || item.costMicros === null) return "turn cost unavailable";
  return `turn ${formatMicros(item.costMicros)}`;
}

function summarizeUnknown(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = sanitizeTerminalText(typeof value === "string" ? value : JSON.stringify(value));
  if (!text) return "";
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
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

function summarizeUsageTokens(usage: NonNullable<Extract<ServerFrame, { type: "run.final_result" }>["event"]["payload"]["usage"]>): { tokens: number | null; partial: boolean } {
  if (usage.usage_source === "unavailable" || (usage.input_tokens === null && usage.output_tokens === null)) {
    return { tokens: null, partial: true };
  }
  return {
    tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    partial: usage.input_tokens === null || usage.output_tokens === null,
  };
}
