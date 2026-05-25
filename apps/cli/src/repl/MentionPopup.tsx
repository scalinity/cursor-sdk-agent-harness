import React from "react";
import { Box, Text } from "ink";
import type { ContextChip, ContextMentionKind, ContextSearchResult } from "@harness/shared";
import type { MentionSelectionItem } from "../types.js";

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
}

export function MentionPopup({ results, selectedIndex }: MentionPopupProps) {
  const items = flattenMentionResults(results).slice(0, 8);
  if (items.length === 0) return null;
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      {items.map((item, index) => {
        const textProps = index === selectedIndex ? { color: "cyan" as const } : {};
        return (
          <Text key={`${item.kind}:${item.value}`} {...textProps}>
            {index === selectedIndex ? "› " : "  "}
            {iconForKind(item.kind)} {item.label} <Text dimColor>{item.detail}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

function iconForKind(kind: MentionSelectionItem["kind"]): string {
  switch (kind) {
    case "file":
      return "•";
    case "folder":
      return "▸";
    case "symbol":
      return "ƒ";
    default:
      return "@";
  }
}
