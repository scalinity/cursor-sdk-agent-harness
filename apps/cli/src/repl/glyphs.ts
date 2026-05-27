export const glyph = {
  running: "▸",
  done: "✓",
  failed: "✗",
  paused: "⏸",
  retry: "↺",
  thinking: "◐",
  readyDot: "●",
} as const;

/** Quarter-circle variants of `glyph.thinking` — the only animated thinking spinner frames. */
export const thinkingSpinnerFrames = ["◐", "◑", "◒", "◓"] as const;

export type GlyphName = keyof typeof glyph;
