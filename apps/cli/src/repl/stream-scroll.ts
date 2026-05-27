import type { StreamItem } from "./StreamView.js";
import { computeStreamViewportState } from "./StreamView.js";

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
  const viewport = computeStreamViewportState(items, width, height, scrollOffset, activeLabel);
  return {
    maxOffset: viewport.maxOffset,
    bodyHeight: viewport.bodyHeight,
    effectiveOffset: viewport.effectiveOffset,
    streamScrollActive: viewport.streamScrollActive,
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
  if (key.ctrl && key.input === "g") return currentOffset > 0 ? -currentOffset : null;
  if (layout.maxOffset <= 0) return null;

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
      ? "↑↓ scroll · Ctrl+G latest"
      : "↑↓ prompts";
  }
  if (streamScrollActive) {
    return "Enter submit · Shift+Enter newline · ↑↓ scroll · Shift+↑↓ faster · Ctrl+↑↓ prompt history · PgUp/Dn · Ctrl+G latest · drop image · Esc dismiss";
  }
  return "Enter submit · Shift+Enter newline · ↑↓ prompt history · PgUp/Dn scroll · drop image · Esc dismiss";
}
