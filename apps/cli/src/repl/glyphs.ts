export const glyph = {
  running: "▸",
  done: "✓",
  failed: "✗",
  paused: "⏸",
  retry: "↺",
  thinking: "◐",
  readyDot: "●",
  agent: "◆",
} as const;

export type GlyphName = keyof typeof glyph;
