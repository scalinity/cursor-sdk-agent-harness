/**
 * useMidnightTick — schedules a setTimeout to the next local midnight so
 * date-bucketed components re-render and refresh their bucket boundaries.
 * Returns a tick counter that increments at each midnight; consumers
 * include it in a useMemo dep to force recomputation.
 */
import { useEffect, useState } from "react";

function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

export function useMidnightTick(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const delay = msUntilNextLocalMidnight(new Date());
      timer = setTimeout(() => {
        setTick((t) => t + 1);
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  return tick;
}
