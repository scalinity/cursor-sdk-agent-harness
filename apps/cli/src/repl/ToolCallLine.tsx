import React from "react";
import { Text } from "ink";
import cliSpinners from "cli-spinners";
import { sanitizeTerminalText } from "../output/sanitize.js";
import { styles } from "../render/styles.js";

export interface ToolCallLineProps {
  verb: string;
  primaryArg: string;
  secondaryDetail?: string;
  status: "running" | "completed" | "error" | "cancelled";
  durationMs?: number;
  error?: string;
}

/** Shared, sanitized `{verb} {primaryArg} {secondaryDetail}` core for both the
 * frozen tool line and the live overlay. Sanitizing here means every tool-line
 * sink is safe regardless of whether the caller passed pre-cleaned fields. */
function formatToolSummary(input: { verb: string; primaryArg: string; secondaryDetail?: string }): string {
  const verb = sanitizeTerminalText(input.verb);
  const primary = input.primaryArg ? ` ${sanitizeTerminalText(input.primaryArg)}` : "";
  const detail = input.secondaryDetail ? ` ${sanitizeTerminalText(input.secondaryDetail)}` : "";
  return `${verb}${primary}${detail}`;
}

export function formatToolCallLine(input: ToolCallLineProps): string {
  const summary = formatToolSummary(input);
  if (input.status === "cancelled") {
    return `${styles.muted("⏸")} ${styles.muted(`${summary} (cancelled)`)}`;
  }
  const glyphChar = input.status === "running" ? (cliSpinners.dots.frames[0] ?? "⠋") : input.status === "completed" ? "✓" : "✗";
  const glyph = input.status === "running" ? styles.glyphRun(glyphChar) : input.status === "completed" ? styles.glyphOk(glyphChar) : styles.glyphErr(glyphChar);
  const duration = input.durationMs !== undefined ? `   ${(input.durationMs / 1000).toFixed(1)}s` : "";
  const error = input.error ? styles.error(` — ${sanitizeTerminalText(input.error)}`) : "";
  return `${glyph} ${styles.tool(`${summary}${duration}`)}${error}`;
}

/** Live, animated line for a running tool: spinner + summary + elapsed seconds.
 * Shares formatToolSummary with the frozen line, so the live→frozen handoff
 * stays in sync and both are sanitized identically. */
export function formatActiveToolLine(spinner: string, input: { verb: string; primaryArg: string; secondaryDetail?: string }, elapsedMs: number): string {
  return `${spinner} ${formatToolSummary(input)}  ${Math.floor(elapsedMs / 1000)}s`;
}

export function ToolCallLine(props: ToolCallLineProps) {
  const color = props.status === "error" ? "red" : props.status === "completed" ? "green" : "yellow";
  return <Text color={color}>{formatToolCallLine(props)}</Text>;
}
