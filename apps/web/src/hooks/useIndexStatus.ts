import { useCallback, useRef, useState } from "react";
import { indexStatusSchema, type IndexStatus } from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useMutatingRequest } from "./useMutatingRequest.js";
import { useMountEffect } from "./useMountEffect.js";

const POLL_MS = 8000;

export interface UseIndexStatusResult {
  status: IndexStatus | null;
  reindex: () => Promise<void>;
}

/**
 * Phase 23 — polls the semantic index status for the active workspace and
 * auto-kicks a first index when the workspace is selected but unindexed.
 */
export function useIndexStatus(): UseIndexStatusResult {
  const mutate = useMutatingRequest();
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const kicked = useRef(false);

  const reindex = useCallback(async () => {
    await mutate("/api/search/reindex", { method: "POST" });
  }, [mutate]);

  const load = useCallback(async () => {
    try {
      const data = await httpRequest("/api/search/index-status", {
        responseSchema: indexStatusSchema,
      });
      setStatus(data);
      // First selection of a workspace with no index → kick one (once).
      if (!kicked.current && data.workspaceId !== null && data.status === "pending") {
        kicked.current = true;
        await reindex();
      }
    } catch {
      // Index status is best-effort; ignore transient failures.
    }
  }, [reindex]);

  useMountEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  });

  return { status, reindex };
}
