import React from "react";
import { Box, Text } from "ink";
import { sanitizeTerminalText } from "../output/sanitize.js";
import type { CliMode } from "../types.js";
import { statusColor, truncateMiddle, fg, bg, type TuiTheme } from "./theme.js";

export interface HeaderBarProps {
  width: number;
  workspace: string;
  mode: CliMode;
  modelId: string;
  connection: "ready" | "connecting" | "connected" | "reconnecting" | "disconnected";
  activeRunId: string | null;
  queuedPrompts: number;
  spinner: string;
  theme: TuiTheme;
}

export function HeaderBar({ width, workspace, mode, modelId, connection, activeRunId, queuedPrompts, spinner, theme }: HeaderBarProps) {
  const leftWidth = Math.max(18, Math.floor(width * 0.56));
  const rightWidth = Math.max(12, width - leftWidth - 4);
  const cwdLabel = truncateMiddle(sanitizeTerminalText(workspace), leftWidth);
  const title = width < 84 ? "HARNESS" : "Cursor Harness";
  const activity = activeRunId ? `${spinner} running ${activeRunId.slice(0, 8)}` : queuedPrompts > 0 ? `${queuedPrompts} queued` : "ready";
  const modelLabel = truncateMiddle(`${mode} · ${sanitizeTerminalText(modelId)}`, rightWidth);
  return (
    <Box flexDirection="column" width={width} paddingX={1} paddingTop={0} {...bg(theme.background)}>
      <Box width={Math.max(1, width - 2)} justifyContent="space-between">
        <Text {...fg(theme.accentWarm)} bold>▌ {title}</Text>
        <Text {...fg(theme.muted)}>{modelLabel}</Text>
      </Box>
      <Box width={Math.max(1, width - 2)} justifyContent="space-between">
        <Text {...fg(theme.muted)}>cwd {cwdLabel}</Text>
        <Text {...fg(statusColor(theme, connection))}>{activity}</Text>
      </Box>
    </Box>
  );
}
