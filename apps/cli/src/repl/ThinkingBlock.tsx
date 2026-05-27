import React from "react";
import { Box, Text } from "ink";
import { glyph } from "./glyphs.js";

export function formatThinking(text: string, collapsed = false): string {
  if (collapsed) return `${glyph.running} Thinking (${text.split(/\s+/).filter(Boolean).length} tokens)`;
  const body = text.split("\n").map((line) => `  ${line}`).join("\n");
  return `${glyph.thinking} Thinking...\n${body}`;
}

export function ThinkingBlock({ text, collapsed = false }: { text: string; collapsed?: boolean }) {
  return (
    <Box flexDirection="column">
      <Text dimColor italic>{formatThinking(text, collapsed)}</Text>
    </Box>
  );
}
