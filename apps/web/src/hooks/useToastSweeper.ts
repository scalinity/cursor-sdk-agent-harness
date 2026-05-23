/**
 * useToastSweeper — schedules a single timer to dismiss expired toasts.
 * Reschedules whenever the next-expiring toast changes. Without this,
 * toasts accumulate indefinitely (RV2-S8).
 */
import { useEffect } from "react";
import { useUiStore } from "../state/ui-store.js";

export function useToastSweeper(): void {
  const toasts = useUiStore((s) => s.toasts);
  const sweep = useUiStore((s) => s.sweepExpiredToasts);

  useEffect(() => {
    if (toasts.length === 0) return;
    const expiries = toasts
      .map((t) => t.expiresAt)
      .filter((e): e is number => e !== null);
    if (expiries.length === 0) return;
    const nextExpiry = Math.min(...expiries);
    const delay = Math.max(0, nextExpiry - Date.now());
    const handle = setTimeout(() => sweep(), delay);
    return () => clearTimeout(handle);
  }, [toasts, sweep]);
}
