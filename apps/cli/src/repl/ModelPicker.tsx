import React from "react";
import { Box, Text } from "ink";
import { bg, border, fg, type TuiTheme } from "./theme.js";
import { glyph } from "./glyphs.js";

export interface ModelPickerRow {
  id: string;
  name: string;
  /** Short provider label (e.g. "cursor", "anthropic", "auto"). */
  provider: string;
  /** True for the agent's current model, so it can be marked. */
  current?: boolean;
}

export const MODEL_PICKER_WINDOW = 8;

export function moveModelSelection(current: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return (current + delta + total) % total;
}

/**
 * The visible slice of rows for a given selection, so a long catalog scrolls
 * within a fixed window instead of overflowing the terminal. Keeps the selected
 * row inside the window, biased a few rows down from the top.
 */
export function modelPickerWindow(
  rows: readonly ModelPickerRow[],
  selectedIndex: number,
  windowSize = MODEL_PICKER_WINDOW,
): { rows: ModelPickerRow[]; start: number } {
  if (rows.length <= windowSize) return { rows: [...rows], start: 0 };
  const maxStart = rows.length - windowSize;
  const start = Math.min(Math.max(0, selectedIndex - 3), maxStart);
  return { rows: rows.slice(start, start + windowSize), start };
}

export interface ModelPickerProps {
  rows: readonly ModelPickerRow[];
  selectedIndex: number;
  loading?: boolean;
  theme: TuiTheme;
}

export function ModelPicker({ rows, selectedIndex, loading = false, theme }: ModelPickerProps) {
  const borderColor = theme.border;
  if (loading) {
    return (
      <Box flexDirection="column" borderStyle="round" {...border(borderColor)} paddingX={1} {...bg(theme.panel)}>
        <Text {...fg(theme.muted)}>MODEL CATALOG</Text>
        <Text {...fg(theme.muted)}>loading models…</Text>
      </Box>
    );
  }
  if (rows.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" {...border(borderColor)} paddingX={1} {...bg(theme.panel)}>
        <Text {...fg(theme.muted)}>MODEL CATALOG</Text>
        <Text {...fg(theme.muted)}>no models available — set an API key first</Text>
      </Box>
    );
  }
  const view = modelPickerWindow(rows, selectedIndex);
  return (
    <Box flexDirection="column" borderStyle="round" {...border(borderColor)} paddingX={1} {...bg(theme.panel)}>
      <Text {...fg(theme.muted)}>MODEL CATALOG  <Text {...fg(theme.muted)}>↑↓ choose · ↵ select · esc cancel</Text></Text>
      {view.rows.map((row, index) => {
        const absolute = view.start + index;
        const selected = absolute === selectedIndex;
        return (
          <Text key={row.id} {...fg(theme.text)} bold={selected}>
            <Text {...fg(selected ? theme.state?.ready : theme.muted)}>{selected ? `${glyph.readyDot} ` : "  "}</Text>
            {row.name}
            {row.current ? <Text {...fg(theme.state?.ready)}> (current)</Text> : null}
            <Text {...fg(theme.muted)}>  {row.provider} · {row.id}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
