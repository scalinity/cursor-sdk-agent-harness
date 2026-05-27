import { useEffect, useState } from "react";
import spinners from "cli-spinners";

const FRAMES = spinners.dots.frames;
const THINKING_DOT_FRAMES = ["Thinking   ", "Thinking.  ", "Thinking.. ", "Thinking..."] as const;
export const THINKING_DOT_FRAME_HOLD = 8;

export interface SpinnerFrameState {
  frame: string;
  index: number;
}

export interface ThinkingGradientColors {
  dim?: string | undefined;
  mid?: string | undefined;
  bright?: string | undefined;
}

export interface ThinkingGradientSegment {
  text: string;
  color?: string;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function formatThinkingIndicatorText(frameIndex: number): string {
  const phase = Math.floor(Math.max(0, frameIndex) / THINKING_DOT_FRAME_HOLD);
  return THINKING_DOT_FRAMES[positiveModulo(phase, THINKING_DOT_FRAMES.length)] ?? "Thinking...";
}

export function thinkingGradientPeakIndex(frameIndex: number, width: number): number {
  const safeWidth = Math.max(1, width);
  if (safeWidth === 1) return 0;
  const period = (safeWidth - 1) * 2;
  const offset = positiveModulo(frameIndex, period);
  return offset <= safeWidth - 1 ? offset : period - offset;
}

export function formatThinkingGradientSegments(
  text: string,
  peakIndex: number,
  colors: ThinkingGradientColors,
): ThinkingGradientSegment[] {
  return Array.from(text).map((character, index) => {
    const distance = Math.abs(index - peakIndex);
    const color = distance === 0 ? colors.bright : distance === 1 ? colors.mid : colors.dim;
    return color === undefined ? { text: character } : { text: character, color };
  });
}

export function useSpinnerFrameState(active: boolean): SpinnerFrameState {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % FRAMES.length);
    }, spinners.dots.interval);
    return () => clearInterval(timer);
  }, [active]);

  return { frame: active ? FRAMES[index] ?? "⠋" : "", index };
}

export function useSpinnerFrame(active: boolean): string {
  return useSpinnerFrameState(active).frame;
}
