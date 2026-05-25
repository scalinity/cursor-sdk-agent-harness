/**
 * useGitStatus — polls `GET /api/git/status` on mount and every 30 seconds.
 * Returns branch name, dirty state, ahead/behind counts, and whether the
 * active workspace is inside a git repo. On error, returns safe defaults.
 *
 * useEffect is allowed in hooks per CLAUDE.md.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { gitStatusResponseSchema } from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";

export interface GitStatusResult {
  branch: string | null;
  isDirty: boolean;
  ahead: number;
  behind: number;
  isGitRepo: boolean;
  isLoading: boolean;
}

const POLL_INTERVAL_MS = 30_000;

const DEFAULTS: GitStatusResult = {
  branch: null,
  isDirty: false,
  ahead: 0,
  behind: 0,
  isGitRepo: false,
  isLoading: true,
};

export function useGitStatus(): GitStatusResult {
  const [state, setState] = useState<GitStatusResult>(DEFAULTS);
  const mountedRef = useRef(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await httpRequest("/api/git/status", {
        responseSchema: gitStatusResponseSchema,
      });
      if (!mountedRef.current) return;
      setState({
        branch: res.branch,
        isDirty: res.isDirty,
        ahead: res.ahead,
        behind: res.behind,
        isGitRepo: res.isGitRepo,
        isLoading: false,
      });
    } catch {
      if (!mountedRef.current) return;
      setState({ ...DEFAULTS, isLoading: false });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchStatus();
    const id = setInterval(() => void fetchStatus(), POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchStatus]);

  return state;
}
