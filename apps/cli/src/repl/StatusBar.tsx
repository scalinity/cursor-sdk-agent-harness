import React from "react";
import { Box, Text } from "ink";
import { sanitizeTerminalText } from "../output/sanitize.js";
import { formatMicros } from "../output/table.js";
import type { CliMode } from "../types.js";

export interface StatusBarProps {
  agentName: string;
  modelId: string;
  mode: CliMode;
  sessionCostMicros: number;
  connection: "connected" | "reconnecting" | "disconnected";
}

export function formatStatusBar(props: StatusBarProps): string {
  return `agent: ${sanitizeTerminalText(props.agentName)} │ ${sanitizeTerminalText(props.modelId)} │ ${props.mode} │ session: ${formatMicros(props.sessionCostMicros)} │ ws: ${props.connection}`;
}

export function StatusBar(props: StatusBarProps) {
  const color = props.connection === "connected" ? "green" : props.connection === "reconnecting" ? "yellow" : "red";
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text>{`agent: ${sanitizeTerminalText(props.agentName)} │ ${sanitizeTerminalText(props.modelId)} │ ${props.mode} │ session: ${formatMicros(props.sessionCostMicros)} │ ws: `}</Text>
      <Text color={color}>{props.connection}</Text>
    </Box>
  );
}
