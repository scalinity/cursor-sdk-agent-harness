import type { StreamItem } from "./StreamView.js";
import { maxStreamScrollOffset } from "./StreamView.js";

export interface StreamViewportLayout {
  maxOffset: number;
  bodyHeight: number;
  effectiveOffset: number;
  streamScrollActive: boolean;
}

export interface StreamScrollKeyInput {
  upArrow?: boolean;
  downArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  input?: string;
}

export function computeStreamViewportLayout(
  items: readonly StreamItem[],
  width: number,
  height: number,
  scrollOffset: number,
  activeLabel?: string,
): StreamViewportLayout {
  const maxOffset = maxStreamScrollOffset(items, width, height, activeLabel);
  const effectiveOffset = Math.min(Math.max(0, scrollOffset), maxOffset);
  const labelHeight = activeLabel ? 1 : 0;
  const indicatorHeight = effectiveOffset > 0 ? 1 : 0;
  const bodyHeight = Math.max(1, height - labelHeight - indicatorHeight);
  return {
    maxOffset,
    bodyHeight,
    effectiveOffset,
    streamScrollActive: effectiveOffset > 0 || maxOffset > 0,
  };
}

export function streamScrollPageStep(bodyHeight: number): number {
  return Math.max(3, Math.floor(bodyHeight * 0.8));
}

export function resolveStreamScrollDelta(
  key: StreamScrollKeyInput,
  layout: Pick<StreamViewportLayout, "bodyHeight" | "maxOffset">,
  currentOffset: number,
): number | null {
  if (key.ctrl && key.input === "g") return -currentOffset;

  const step = key.shift ? 5 : 1;
  if (key.upArrow && !key.ctrl && !key.meta) return step;
  if (key.downArrow && !key.ctrl && !key.meta) return -step;
  if (key.pageUp) return streamScrollPageStep(layout.bodyHeight);
  if (key.pageDown) return -streamScrollPageStep(layout.bodyHeight);
  return null;
}

export function applyStreamScrollDelta(currentOffset: number, delta: number, maxOffset: number): number {
  if (delta < 0) return Math.max(0, currentOffset + delta);
  return Math.min(maxOffset, currentOffset + delta);
}

/** When true, InputBar should not bind plain ↑/↓ to prompt history. */
export function shouldReserveArrowKeysForStreamScroll(streamScrollActive: boolean): boolean {
  return streamScrollActive;
}

/** When true, prompt history uses Ctrl+↑/↓ instead of plain ↑/↓. */
export function shouldUseCtrlForPromptHistory(streamScrollActive: boolean): boolean {
  return streamScrollActive;
}

export function formatStreamScrollHints(streamScrollActive: boolean, compact: boolean): string {
  if (compact) {
    return streamScrollActive
      ? "^C cancel · ^D quit · ^L clear · ↑↓ scroll · Ctrl+G latest"
      : "^C cancel · ^D quit · ^L clear · ↑↓ prompts";
  }
  if (streamScrollActive) {
    return "Enter submit · Shift+Enter newline · ↑↓ scroll · Shift+↑↓ faster · Ctrl+↑↓ prompt history · PgUp/Dn · Ctrl+G latest · drop image · Esc dismiss · ^C cancel/quit · ^L clear";
  }
  return "Enter submit · Shift+Enter newline · ↑↓ prompt history · PgUp/Dn scroll · drop image · Esc dismiss · ^C cancel/quit · ^L clear";
}
