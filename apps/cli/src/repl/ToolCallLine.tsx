import React from "react";
import { Text } from "ink";
import cliSpinners from "cli-spinners";
import { sanitizeTerminalText } from "../output/sanitize.js";

export interface ToolCallLineProps {
  verb: string;
  primaryArg: string;
  secondaryDetail?: string;
  status: "running" | "completed" | "error";
  durationMs?: number;
  error?: string;
}

export function formatToolCallLine(input: ToolCallLineProps): string {
  const marker = input.status === "running" ? cliSpinners.dots.frames[0] : input.status === "completed" ? "✓" : "✗";
  const primary = input.primaryArg ? ` ${input.primaryArg}` : "";
  const detail = input.secondaryDetail ? ` ${input.secondaryDetail}` : "";
  const duration = input.durationMs !== undefined ? `   ${(input.durationMs / 1000).toFixed(1)}s` : "";
  const error = input.error ? ` — ${sanitizeTerminalText(input.error)}` : "";
  return `${marker} ${input.verb}${primary}${detail}${duration}${error}`;
}

export function ToolCallLine(props: ToolCallLineProps) {
  const color = props.status === "error" ? "red" : props.status === "completed" ? "green" : "yellow";
  return <Text color={color}>{formatToolCallLine(props)}</Text>;
}
