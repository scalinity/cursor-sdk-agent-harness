/**
 * useErrorReporter — converts caught errors into UI toasts + console logs.
 * Components call the returned `report` function from event handlers; do
 * not invoke this hook in `useEffect` chains that re-fire on every render.
 */
import { useCallback } from "react";
import { useUiStore } from "../state/ui-store.js";

export interface ErrorReporter {
  report: (error: unknown, opts?: { severity?: "info" | "warn" | "error" }) => void;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function useErrorReporter(scope: string): ErrorReporter {
  const pushToast = useUiStore((s) => s.pushToast);
  const report = useCallback<ErrorReporter["report"]>(
    (error, opts) => {
      const message = describe(error);
      // Console at warn so production browser tools still surface it.
      // Error objects keep their stack via the structured Console API.
      console.warn(`[${scope}]`, error);
      pushToast({ scope, message, severity: opts?.severity ?? "error" });
    },
    [scope, pushToast],
  );
  return { report };
}
