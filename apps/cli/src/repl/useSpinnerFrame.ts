import { useEffect, useState } from "react";
import spinners from "cli-spinners";

const FRAMES = spinners.dots.frames;
const THINKING_DOT_FRAMES = ["Thinking   ", "Thinking.  ", "Thinking.. ", "Thinking..."] as const;

export interface SpinnerFrameState {
  frame: string;
  index: number;
}

export function formatThinkingIndicatorText(frameIndex: number): string {
  const normalized = ((frameIndex % THINKING_DOT_FRAMES.length) + THINKING_DOT_FRAMES.length) % THINKING_DOT_FRAMES.length;
  return THINKING_DOT_FRAMES[normalized] ?? "Thinking...";
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