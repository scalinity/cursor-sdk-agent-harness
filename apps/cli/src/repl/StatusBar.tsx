import path from "node:path";
import React from "react";
import { Box, Text } from "ink";
import { sanitizeTerminalText } from "../output/sanitize.js";
import { formatMicros } from "../output/table.js";
import type { CliMode } from "../types.js";
import { bg, createTuiTheme, fg, truncateMiddle, type TuiTheme } from "./theme.js";

export interface StatusBarProps {
  workspace: string;
  modelId: string;
  mode: CliMode;
  sessionCostMicros: number;
  connection: "ready" | "connecting" | "connected" | "reconnecting" | "disconnected";
  queuedPrompts?: number;
  activeRunId?: string | null;
  width?: number;
  theme?: TuiTheme;
}

export function formatStatusBar(props: StatusBarProps): string {
  return `dir: ${workspaceLabel(props.workspace)} │ ${sanitizeTerminalText(props.modelId)} │ ${props.mode} │ session: ${formatMicros(props.sessionCostMicros)} │ ws: ${props.connection}`;
}

export function StatusBar(props: StatusBarProps) {
  const theme = props.theme ?? createTuiTheme();
  const width = props.width ?? process.stdout.columns ?? 80;
  const cwd = `dir: ${workspaceLabel(props.workspace)}`;
  const model = `${props.mode} · ${sanitizeTerminalText(props.modelId)}`;
  const runState = props.activeRunId ? `run ${props.activeRunId.slice(0, 8)}` : props.queuedPrompts ? `${props.queuedPrompts} queued` : "idle";
  const compact = width < 120;
  const hints = compact ? "^C cancel · ^D quit · ^L clear" : "Enter submit · Shift+Enter newline · ↑↓ history · Esc dismiss · ^C cancel/quit · ^L clear";
  const details = compact ? `${cwd} · ws ${props.connection} · ${formatMicros(props.sessionCostMicros)} · ${hints}` : `${cwd} · ${model} · ${runState} · ws ${props.connection} · ${formatMicros(props.sessionCostMicros)} · ${hints}`;
  const line = truncateMiddle(details, Math.max(1, width - 2));
  return (
    <Box width={width} paddingX={1} {...bg(theme.panelSoft)}>
      <Text {...fg(theme.muted)}>{line}</Text>
    </Box>
  );
}

function workspaceLabel(workspace: string): string {
  const base = path.basename(workspace);
  return sanitizeTerminalText(base || workspace);
}
