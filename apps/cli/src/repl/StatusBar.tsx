import React from "react";
import { Box, Text } from "ink";
import { formatMicros } from "../output/table.js";
import { bg, createTuiTheme, fg, truncateMiddle, type TuiTheme } from "./theme.js";
import { formatStreamScrollHints } from "./stream-scroll.js";

export interface SessionCostState {
  micros: number;
  hasUnavailableTurn: boolean;
}

export type LiveTurnUsage =
  | { status: "available"; tokens: number; costMicros: number | null }
  | { status: "unavailable" };

export interface StatusBarProps {
  sessionCost: SessionCostState;
  turnUsage?: LiveTurnUsage | null;
  streamScrollActive?: boolean;
  width?: number;
  theme?: TuiTheme;
}

export function formatStatusBar(props: StatusBarProps, options: { width?: number } = {}): string {
  const width = options.width ?? props.width ?? 80;
  return formatStatusDetails(props, width < 120);
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
  const hints = formatStreamScrollHints(props.streamScrollActive ?? false, compact);
  const sessionCost = formatSessionCost(props.sessionCost);
  const usage = props.turnUsage ? `${formatLiveTurnUsage(props.turnUsage)} · ` : "";
  return `${usage}${sessionCost} · ${hints}`;
}

function formatSessionCost(cost: SessionCostState): string {
  if (cost.hasUnavailableTurn && cost.micros === 0) return "session unavailable";
  if (cost.hasUnavailableTurn) return `session partial ${formatMicros(cost.micros)}`;
  return `session ${formatMicros(cost.micros)}`;
}

function formatLiveTurnUsage(usage: LiveTurnUsage): string {
  if (usage.status === "unavailable") return "turn usage unavailable";
  return `${usage.tokens.toLocaleString("en-US")} tok · turn ${formatMicros(usage.costMicros)}`;
}
