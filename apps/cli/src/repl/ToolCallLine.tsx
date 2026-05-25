import React from "react";
import { Text } from "ink";
import cliSpinners from "cli-spinners";

export interface ToolCallLineProps {
  name: string;
  status: "running" | "completed" | "error";
  summary?: string;
  durationMs?: number;
  error?: string;
}

export function formatToolCallLine(input: ToolCallLineProps): string {
  const marker = input.status === "running" ? cliSpinners.dots.frames[0] : input.status === "completed" ? "✓" : "✗";
  const duration = input.durationMs !== undefined ? ` (${(input.durationMs / 1000).toFixed(1)}s)` : "";
  const summary = input.summary ? ` ${input.summary}` : "";
  const error = input.error ? ` — ${input.error}` : "";
  return `${marker} ${input.name}${summary}${duration}${error}`;
}

export function ToolCallLine(props: ToolCallLineProps) {
  const color = props.status === "error" ? "red" : props.status === "completed" ? "green" : "yellow";
  return <Text color={color}>{formatToolCallLine(props)}</Text>;
}
