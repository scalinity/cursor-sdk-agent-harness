/**
 * useSubagents — wraps `/api/subagents`. CRUD over Subagent Definitions.
 * Model overrides accept `null` (inherit from parent) or `{ id }`.
 *
 * Spec §5 Subagent CRUD; phase 12.
 */
import { useCallback, useState } from "react";
import {
  listSubagentsResponseSchema,
  subagentSummarySchema,
  type CreateSubagentRequest,
  type ReplaceSubagentRequest,
  type SubagentSummary,
  type UpdateSubagentRequest,
} from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useMountEffect } from "./useMountEffect.js";
import { useMutatingRequest } from "./useMutatingRequest.js";

export interface UseSubagentsResult {
  subagents: SubagentSummary[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (input: CreateSubagentRequest) => Promise<SubagentSummary>;
  replace: (id: string, input: ReplaceSubagentRequest) => Promise<SubagentSummary>;
  patch: (id: string, input: UpdateSubagentRequest) => Promise<SubagentSummary>;
  remove: (id: string) => Promise<void>;
}

export function useSubagents(): UseSubagentsResult {
  const [subagents, setSubagents] = useState<SubagentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutate = useMutatingRequest();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await httpRequest("/api/subagents", {
        responseSchema: listSubagentsResponseSchema,
      });
      setSubagents(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "subagents load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const create = useCallback(
    async (input: CreateSubagentRequest) => {
      const created = await mutate("/api/subagents", {
        method: "POST",
        body: input,
        responseSchema: subagentSummarySchema,
      });
      setSubagents((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      return created;
    },
    [mutate],
  );

  const replace = useCallback(
    async (id: string, input: ReplaceSubagentRequest) => {
      const updated = await mutate(`/api/subagents/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: input,
        responseSchema: subagentSummarySchema,
      });
      setSubagents((prev) => prev.map((s) => (s.id === id ? updated : s)));
      return updated;
    },
    [mutate],
  );

  const patch = useCallback(
    async (id: string, input: UpdateSubagentRequest) => {
      const updated = await mutate(`/api/subagents/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: input,
        responseSchema: subagentSummarySchema,
      });
      setSubagents((prev) => prev.map((s) => (s.id === id ? updated : s)));
      return updated;
    },
    [mutate],
  );

  const remove = useCallback(
    async (id: string) => {
      await mutate(`/api/subagents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setSubagents((prev) => prev.filter((s) => s.id !== id));
    },
    [mutate],
  );

  // REVIEW-S7: explicit mount-only hydration via useMountEffect wrapper.
  useMountEffect(() => {
    void reload();
  });

  return {
    subagents,
    loading,
    error,
    reload,
    create,
    replace,
    patch,
    remove,
  };
}
