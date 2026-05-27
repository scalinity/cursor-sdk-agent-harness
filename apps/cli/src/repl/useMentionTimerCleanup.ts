import { useEffect, type MutableRefObject } from "react";

export function useMentionTimerCleanup(
  timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  requestSeqRef: MutableRefObject<number>,
): void {
  useEffect(() => {
    return () => {
      requestSeqRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [requestSeqRef, timerRef]);
}
