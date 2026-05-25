/**
 * useCopyToClipboard — copies text to the clipboard and flips a `copied`
 * flag to true for 2 seconds so the caller can show a checkmark.
 *
 * useEffect is allowed in hooks per CLAUDE.md (effects are banned only
 * inside component/page files).
 */
import { useCallback, useEffect, useRef, useState } from "react";

const COPIED_DURATION_MS = 2_000;

export interface UseCopyToClipboardResult {
  copied: boolean;
  copy: (text: string) => void;
}

export function useCopyToClipboard(): UseCopyToClipboardResult {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, COPIED_DURATION_MS);
    });
  }, []);

  // Cleanup the timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return { copied, copy };
}
