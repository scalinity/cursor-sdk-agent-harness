import React from "react";
import { Box, Text } from "ink";
import type { ContextChip, ContextMentionKind, ContextSearchResult } from "@harness/shared";
import type { MentionSelectionItem } from "../types.js";
import { bg, border, createTuiTheme, fg, type TuiTheme } from "./theme.js";

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

export function MentionPopup({ results, selectedIndex, focused = true, open = results !== null, theme = createTuiTheme() }: MentionPopupProps) {
  const items = flattenMentionResults(results).slice(0, MAX_MENTION_ITEMS);
  if (!open) return null;
  const borderColor = focused ? theme.stateActive : theme.border;
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
        return (
          <Text key={`${item.kind}:${item.value}`} {...fg(selected ? theme.stateActive : theme.text)} bold={selected}>
            {selected ? "▸ " : "  "}
            {iconForKind(item.kind)} {item.label} <Text {...fg(theme.muted)}>{item.detail}</Text>
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
