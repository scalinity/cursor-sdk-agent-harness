import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { CliStreamPort } from "../types.js";

export interface ReplCleanupInput {
  stream: CliStreamPort;
  activeRunId: string | null;
  isStartingRun: boolean;
}

export interface ReplCleanupController {
  cleanupNow: () => void;
  disposedRef: MutableRefObject<boolean>;
  cancelPendingStartRef: MutableRefObject<boolean>;
}

export function useReplCleanup({ stream, activeRunId, isStartingRun }: ReplCleanupInput): ReplCleanupController {
  const activeRunIdRef = useRef(activeRunId);
  const isStartingRunRef = useRef(isStartingRun);
  const disposedRef = useRef(false);
  const cancelPendingStartRef = useRef(false);

  activeRunIdRef.current = activeRunId;
  isStartingRunRef.current = isStartingRun;

  const cleanupNow = useCallback(() => {
    disposedRef.current = true;
    if (isStartingRunRef.current) cancelPendingStartRef.current = true;
    const runId = activeRunIdRef.current;
    if (runId) stream.cancelRun?.(runId);
    stream.close?.();
  }, [stream]);

  useEffect(() => cleanupNow, [cleanupNow]);

  return { cleanupNow, disposedRef, cancelPendingStartRef };
}
