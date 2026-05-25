import React from "react";
import { Box, Text } from "ink";
import chalk from "chalk";
import type { ServerFrame } from "@harness/shared";
import { sanitizeTerminalText } from "../output/sanitize.js";
import { formatMicros } from "../output/table.js";
import { renderDiff } from "../render/diff.js";
import { renderMarkdown } from "../render/markdown.js";
import { formatToolCallLine } from "./ToolCallLine.js";

const MAX_BUFFER_ITEMS = 5000;
const MAX_TEXT_LINES = 5000;
const MAX_TEXT_BYTES = 512 * 1024;

export type StreamItem =
  | { type: "assistant"; text: string }
  | { type: "thinking"; text: string; collapsed?: boolean }
  | { type: "tool"; callId: string; name: string; status: "running" | "completed" | "error"; summary?: string; durationMs?: number; error?: string }
  | { type: "diff"; path: string; diff: string }
  | { type: "approval"; requestId: string; description: string }
  | { type: "summary"; status: string; tokens: number | null; costMicros: number | null; durationMs: number | null }
  | { type: "error"; message: string };

export interface StreamBuffer {
  items: StreamItem[];
}

export function createStreamBuffer(): StreamBuffer {
  return { items: [] };
}

export function ingestStreamFrame(buffer: StreamBuffer, frame: ServerFrame): StreamBuffer {
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
      const summary = summarizeUnknown(payload.args);
      const existingIndex = items.findIndex((item) => item.type === "tool" && item.callId === payload.call_id);
      const next: StreamItem = {
        type: "tool",
        callId: payload.call_id,
        name: payload.name,
        status: payload.status,
        ...(summary ? { summary } : {}),
        ...(payload.timing?.duration_ms !== undefined ? { durationMs: payload.timing.duration_ms } : {}),
        ...(payload.status === "error" ? { error: summarizeUnknown(payload.result) } : {}),
      };
      if (existingIndex >= 0) items[existingIndex] = next;
      else items.push(next);
      break;
    }
    case "derived.code_edit": {
      for (const edit of frame.event.payload.edits) {
        items.push({ type: "diff", path: edit.path, diff: edit.unifiedDiff ?? buildFallbackDiff(edit.before, edit.after) });
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

export function renderStreamItems(items: readonly StreamItem[]): string {
  return items.map(renderStreamItem).join("\n");
}

export function StreamView({ items }: { items: readonly StreamItem[] }) {
  return (
    <Box flexDirection="column">
      <Text>{renderStreamItems(items)}</Text>
    </Box>
  );
}

function renderStreamItem(item: StreamItem): string {
  switch (item.type) {
    case "assistant":
      return renderMarkdown(item.text);
    case "thinking":
      return chalk.dim(`◐ Thinking...\n  ${sanitizeTerminalText(item.text)}`);
    case "tool":
      return formatToolCallLine(item);
    case "diff":
      return `${chalk.cyan(`┌─ ${sanitizeTerminalText(item.path)} ─`)}\n${renderDiff(item.diff)}\n${chalk.cyan("└────────")}`;
    case "approval":
      return chalk.yellow(`⚠ Approval required: ${sanitizeTerminalText(item.description)} [y]es / [n]o / [a]lways`);
    case "summary":
      return renderSummary(item);
    case "error":
      return chalk.red(sanitizeTerminalText(item.message));
  }
}

function renderSummary(item: Extract<StreamItem, { type: "summary" }>): string {
  const tokens = item.tokens === null ? "tokens unavailable" : `${item.tokens.toLocaleString("en-US")} tokens`;
  const cost = formatMicros(item.costMicros);
  const duration = item.durationMs === null ? "duration n/a" : `${(item.durationMs / 1000).toFixed(1)}s`;
  return `─── ${tokens} · ${cost} · ${duration} · ${item.status} ───`;
}

function summarizeUnknown(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = sanitizeTerminalText(typeof value === "string" ? value : JSON.stringify(value));
  if (!text) return "";
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

function buildFallbackDiff(before: string | undefined, after: string | undefined): string {
  if (before === undefined && after === undefined) return "";
  return [`-${before ?? ""}`, `+${after ?? ""}`].join("\n");
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
