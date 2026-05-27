export const glyph = {
  running: "▸",
  done: "✓",
  failed: "✗",
  paused: "⏸",
  retry: "↺",
  thinking: "◐",
  readyDot: "●",
  cursor: "▸",
  approval: "⚠",
} as const;

export type GlyphName = keyof typeof glyph;
