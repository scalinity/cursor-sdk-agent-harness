import { useEffect, useState } from "react";
import spinners from "cli-spinners";

const FRAMES = spinners.dots.frames;

export function useSpinnerFrame(active: boolean): string {
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

  return active ? FRAMES[index] ?? "⠋" : "";
}