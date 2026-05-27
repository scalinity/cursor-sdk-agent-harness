import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { StreamBuffer } from "./StreamView.js";

export function useResumeNotice(
  enabled: boolean,
  setBuffer: Dispatch<SetStateAction<StreamBuffer>>,
): void {
  const appendedRef = useRef(false);

  useEffect(() => {
    if (!enabled || appendedRef.current) return;
    appendedRef.current = true;
    setBuffer((current) => ({
      items: [...current.items, { type: "system", text: "Resumed previous chat session." }],
    }));
  }, [enabled, setBuffer]);
}
