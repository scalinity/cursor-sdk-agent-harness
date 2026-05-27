import React from "react";
import { Box, Text } from "ink";
import { normalizePath } from "../render/path.js";
import { sanitizeTerminalText } from "../output/sanitize.js";
import { truncateMiddle, fg, bg, type TuiTheme } from "./theme.js";

export type ChromeState = "ready" | "streaming" | "tool-running" | "disconnected" | "error";

export interface HeaderBarProps {
  width: number;
  workspace: string;
  cwdBase: string;
  modelId: string;
  accountLabel: string;
  chromeState: ChromeState;
  queuedPrompts: number;
  theme: TuiTheme;
}

export function HeaderBar({ width, workspace, cwdBase, modelId, accountLabel, chromeState, queuedPrompts, theme }: HeaderBarProps) {
  const leftWidth = Math.max(18, Math.floor(width * 0.56));
  const rightWidth = Math.max(12, width - leftWidth - 4);
  const cwdLabel = formatHeaderCwdLabel(workspace, cwdBase, leftWidth);
  const title = width < 84 ? "HARNESS" : "Cursor Harness";
  const queuedLabel = queuedPrompts > 0 ? `${queuedPrompts} queued` : "";
  const modelLabel = truncateMiddle(formatChromeIndicator(modelId, accountLabel, chromeState), rightWidth);
  return (
    <Box flexDirection="column" width={width} paddingX={1} paddingTop={0} {...bg(theme.background)}>
      <Box width={Math.max(1, width - 2)} justifyContent="space-between">
        <Text {...fg(theme.accentWarm)} bold>▌ {title}</Text>
        <Text {...fg(chromeStateColor(theme, chromeState))}>{modelLabel}</Text>
      </Box>
      <Box width={Math.max(1, width - 2)} justifyContent="space-between">
        <Text {...fg(theme.muted)}>cwd {cwdLabel}</Text>
        <Text {...fg(theme.muted)}>{queuedLabel}</Text>
      </Box>
    </Box>
  );
}

export function formatChromeIndicator(modelId: string, accountLabel: string, state: ChromeState): string {
  return `${sanitizeChromeLine(modelId)} · ${sanitizeChromeLine(accountLabel)} · ${state} ●`;
}

export function formatHeaderCwdLabel(workspace: string, cwdBase: string, maxWidth: number): string {
  return sanitizeChromeLine(normalizePath(workspace, cwdBase, { maxWidth }));
}

function sanitizeChromeLine(value: string): string {
  return sanitizeTerminalText(value).replace(/[\r\n]+/g, " ");
}

function chromeStateColor(theme: TuiTheme, state: ChromeState): string | undefined {
  if (state === "ready") return theme.success;
  if (state === "streaming") return theme.accent;
  if (state === "tool-running") return theme.warning;
  return theme.danger;
}
