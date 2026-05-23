/**
 * useErrorReporter — converts caught errors into UI toasts + console logs.
 * Components call the returned `report` function from event handlers; do
 * not invoke this hook in `useEffect` chains that re-fire on every render.
 *
 * `describe()` handles circular objects, Error.cause chains, and non-Error
 * `unknown` values without throwing.
 */
import { useCallback } from "react";
import { useUiStore } from "../state/ui-store.js";
import { safeJsonString } from "../lib/safe-payload.js";

export interface ErrorReporter {
  report: (error: unknown, opts?: { severity?: "info" | "warn" | "error" }) => void;
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause !== undefined) {
      return `${err.message} (cause: ${describe(cause)})`;
    }
    return err.message;
  }
  if (typeof err === "string") return err;
  return safeJsonString(err);
}

export function useErrorReporter(scope: string): ErrorReporter {
  const pushToast = useUiStore((s) => s.pushToast);
  const report = useCallback<ErrorReporter["report"]>(
    (error, opts) => {
      const message = describe(error);
      const severity = opts?.severity ?? "error";
      // Branch on severity so devtools filtering works correctly (RV2-S7).
      // The Error object itself is logged for stack-trace context regardless
      // of the prose `message`.
      const tag = `[${scope}]`;
      if (severity === "info") console.info(tag, error);
      else if (severity === "warn") console.warn(tag, error);
      else console.error(tag, error);
      pushToast({ scope, message, severity });
    },
    [scope, pushToast],
  );
  return { report };
}
