import path from "node:path";
import React from "react";
import { Box, Text } from "ink";
import { sanitizeTerminalText } from "../output/sanitize.js";
import { formatMicros } from "../output/table.js";
import type { CliMode } from "../types.js";

export interface StatusBarProps {
  workspace: string;
  modelId: string;
  mode: CliMode;
  sessionCostMicros: number;
  connection: "ready" | "connecting" | "connected" | "reconnecting" | "disconnected";
}

export function formatStatusBar(props: StatusBarProps): string {
  return `dir: ${workspaceLabel(props.workspace)} │ ${sanitizeTerminalText(props.modelId)} │ ${props.mode} │ session: ${formatMicros(props.sessionCostMicros)} │ ws: ${props.connection}`;
}

export function StatusBar(props: StatusBarProps) {
  const color = statusColor(props.connection);
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text>{`dir: ${workspaceLabel(props.workspace)} │ ${sanitizeTerminalText(props.modelId)} │ ${props.mode} │ session: ${formatMicros(props.sessionCostMicros)} │ ws: `}</Text>
      <Text color={color}>{props.connection}</Text>
    </Box>
  );
}

function workspaceLabel(workspace: string): string {
  const base = path.basename(workspace);
  return sanitizeTerminalText(base || workspace);
}

function statusColor(status: StatusBarProps["connection"]): "green" | "yellow" | "red" | "cyan" {
  if (status === "connected") return "green";
  if (status === "connecting" || status === "reconnecting") return "yellow";
  if (status === "disconnected") return "red";
  return "cyan";
}
