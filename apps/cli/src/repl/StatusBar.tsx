import React from "react";
import { Box, Text } from "ink";
import { formatMicros } from "../output/table.js";
import { bg, createTuiTheme, fg, truncateMiddle, visibleLength, type TuiTheme } from "./theme.js";
import { formatStreamScrollHints } from "./stream-scroll.js";

export interface SessionCostState {
  micros: number;
  hasUnavailableTurn: boolean;
}

export interface SessionTokenState {
  tokens: number;
  hasUnavailableTurn: boolean;
}

export interface StatusBarProps {
  sessionCost: SessionCostState;
  sessionTokens?: SessionTokenState;
  streamScrollActive?: boolean;
  width?: number;
  theme?: TuiTheme;
}

export function formatStatusBar(props: StatusBarProps, options: { width?: number } = {}): string {
  const width = Math.max(1, options.width ?? props.width ?? 80);
  return formatStatusLine(props, width);
}

export function StatusBar(props: StatusBarProps) {
  const theme = props.theme ?? createTuiTheme();
  const width = props.width ?? process.stdout.columns ?? 80;
  const line = formatStatusLine(props, Math.max(1, width - 2));
  return (
    <Box width={width} paddingX={1} {...bg(theme.panelSoft)}>
      <Text {...fg(theme.muted)}>{line}</Text>
    </Box>
  );
}

function formatStatusLine(props: StatusBarProps, width: number): string {
  const compact = width < 120;
  const hints = formatStreamScrollHints(props.streamScrollActive ?? false, compact);
  const totals = formatSessionTotals(props.sessionCost, props.sessionTokens ?? { tokens: 0, hasUnavailableTurn: false });
  const totalsWidth = visibleLength(totals);
  if (totalsWidth >= width) return truncateMiddle(totals, width);

  const hintWidth = Math.max(0, width - totalsWidth - 1);
  const left = truncateMiddle(hints, hintWidth);
  const gap = Math.max(1, width - visibleLength(left) - totalsWidth);
  return `${left}${" ".repeat(gap)}${totals}`;
}

function formatSessionTotals(cost: SessionCostState, tokens: SessionTokenState): string {
  return `${formatSessionTokens(tokens)} · ${formatSessionCost(cost)}`;
}

function formatSessionTokens(tokens: SessionTokenState): string {
  if (tokens.hasUnavailableTurn && tokens.tokens === 0) return "session tokens unavailable";
  if (tokens.hasUnavailableTurn) return `session partial ${tokens.tokens.toLocaleString("en-US")} tok`;
  return `session ${tokens.tokens.toLocaleString("en-US")} tok`;
}

function formatSessionCost(cost: SessionCostState): string {
  if (cost.hasUnavailableTurn && cost.micros === 0) return "session cost unavailable";
  if (cost.hasUnavailableTurn) return `session partial ${formatMicros(cost.micros)}`;
  return `session ${formatMicros(cost.micros)}`;
}
