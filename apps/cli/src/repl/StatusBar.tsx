import React from "react";
import { Box, Text } from "ink";
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
  const compact = true;
  return formatStatusDetails(props, compact);
}

export function StatusBar(props: StatusBarProps) {
  const theme = props.theme ?? createTuiTheme();
  const width = props.width ?? process.stdout.columns ?? 80;
  const compact = width < 120;
  const details = formatStatusDetails(props, compact);
  const line = truncateMiddle(details, Math.max(1, width - 2));
  return (
    <Box width={width} paddingX={1} {...bg(theme.panelSoft)}>
      <Text {...fg(theme.muted)}>{line}</Text>
    </Box>
  );
}

function formatStatusDetails(props: StatusBarProps, compact: boolean): string {
  const hints = compact ? "^C cancel · ^D quit · ^L clear · PgUp/Dn scroll" : "Enter submit · Shift+Enter newline · ↑↓ history · Shift+↑↓ scroll · Esc dismiss · ^C cancel/quit · ^L clear";
  const sessionCost = `session ${formatMicros(props.sessionCostMicros)}`;
  return `${sessionCost} · ${hints}`;
}
