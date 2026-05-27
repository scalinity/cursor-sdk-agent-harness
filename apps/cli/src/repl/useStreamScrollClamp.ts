import { useEffect, type Dispatch, type SetStateAction } from "react";

export function useStreamScrollClamp(
  scrollOffset: number,
  effectiveOffset: number,
  setScrollOffset: Dispatch<SetStateAction<number>>,
): void {
  useEffect(() => {
    if (scrollOffset !== effectiveOffset) {
      setScrollOffset(effectiveOffset);
    }
  }, [effectiveOffset, scrollOffset, setScrollOffset]);
}
