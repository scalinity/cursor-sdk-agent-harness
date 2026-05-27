import React from "react";
import { Box, Text } from "ink";
import type { ContextChip, ContextMentionKind, ContextSearchResult } from "@harness/shared";
import { sanitizeTerminalText } from "../output/sanitize.js";
import type { MentionSelectionItem } from "../types.js";
import { bg, border, createTuiTheme, fg, type TuiTheme } from "./theme.js";
import { glyph } from "./glyphs.js";

export const MAX_MENTION_ITEMS = 8;

export function flattenMentionResults(results: ContextSearchResult | null): MentionSelectionItem[] {
  if (!results) return [];
  const files = results.files.map((file): MentionSelectionItem => ({
    kind: file.isDirectory ? "folder" : "file",
    value: file.path,
    label: file.name,
    detail: file.path,
  }));
  const symbols = results.symbols.map((symbol): MentionSelectionItem => ({
    kind: "symbol",
    value: `${symbol.path}:${symbol.line}:${symbol.name}`,
    label: symbol.name,
    detail: `${symbol.kind} · ${symbol.path}:${symbol.line}`,
  }));
  return [...files, ...symbols];
}

export function moveMentionSelection(current: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return (current + delta + total) % total;
}

export function mentionItemToChip(item: Pick<MentionSelectionItem, "kind" | "value" | "label">, idNumber: number): ContextChip {
  return {
    id: `chip-${idNumber}`,
    mention: { kind: item.kind as ContextMentionKind, value: item.value, displayLabel: item.label },
  };
}

export interface MentionPopupProps {
  results: ContextSearchResult | null;
  selectedIndex: number;
  open?: boolean;
  focused?: boolean;
  theme?: TuiTheme;
}

export function MentionPopup({ results, selectedIndex, open = results !== null, theme = createTuiTheme() }: MentionPopupProps) {
  const items = flattenMentionResults(results).slice(0, MAX_MENTION_ITEMS);
  if (!open) return null;
  const borderColor = theme.border;
  if (items.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" {...border(borderColor)} paddingX={1} {...bg(theme.panel)}>
        <Text {...fg(theme.muted)}>type to search files, folders, and symbols</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" borderStyle="round" {...border(borderColor)} paddingX={1} {...bg(theme.panel)}>
      <Text {...fg(theme.muted)}>CONTEXT PICKER</Text>
      {items.map((item, index) => {
        const selected = index === selectedIndex;
        const label = sanitizeTerminalText(item.label);
        const detail = sanitizeTerminalText(item.detail);
        return (
          <Text key={`${item.kind}:${item.value}`} {...fg(theme.text)} bold={selected}>
            <Text {...fg(selected ? theme.state?.ready : theme.muted)}>{selected ? `${glyph.readyDot} ` : "  "}</Text>
            {iconForKind(item.kind)} {label} <Text {...fg(theme.muted)}>{detail}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

function iconForKind(kind: MentionSelectionItem["kind"]): string {
  switch (kind) {
    case "file":
      return "file:";
    case "folder":
      return "dir:";
    case "symbol":
      return "sym:";
    default:
      return "@";
  }
}
