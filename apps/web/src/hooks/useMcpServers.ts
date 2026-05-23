/**
 * useMcpServers — wraps `/api/mcp-servers`. Lists, creates, replaces,
 * deletes, and re-validates MCP server definitions. The list endpoint
 * returns redacted configs; the editor fetches raw values via the
 * per-server reveal endpoint.
 *
 * Spec §5 MCP Server CRUD; phase 12.
 */
import { useCallback, useEffect, useState } from "react";
import {
  listMcpServersResponseSchema,
  mcpServerRevealResponseSchema,
  mcpServerSummarySchema,
  type CreateMcpServerRequest,
  type McpServerRevealResponse,
  type McpServerSummary,
  type UpdateMcpServerRequest,
} from "@harness/shared";
import { httpRequest, mutatingRequest } from "../lib/http-client.js";
import { useUiStore } from "../state/ui-store.js";
import { useCsrfToken } from "./useCsrfToken.js";

export interface UseMcpServersResult {
  servers: McpServerSummary[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (input: CreateMcpServerRequest) => Promise<McpServerSummary>;
  replace: (id: string, input: CreateMcpServerRequest) => Promise<McpServerSummary>;
  patch: (id: string, input: UpdateMcpServerRequest) => Promise<McpServerSummary>;
  remove: (id: string) => Promise<void>;
  revalidate: (id: string) => Promise<McpServerSummary>;
  reveal: (id: string) => Promise<McpServerRevealResponse>;
}

export function useMcpServers(): UseMcpServersResult {
  const [servers, setServers] = useState<McpServerSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refresh: refreshCsrfToken } = useCsrfToken();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await httpRequest("/api/mcp-servers", {
        responseSchema: listMcpServersResponseSchema,
      });
      setServers(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "mcp-servers load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const create = useCallback(
    async (input: CreateMcpServerRequest) => {
      const created = await mutatingRequest("/api/mcp-servers", {
        method: "POST",
        body: input,
        getCsrfToken: () => useUiStore.getState().csrfToken,
        refreshCsrfToken,
        responseSchema: mcpServerSummarySchema,
      });
      setServers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      return created;
    },
    [refreshCsrfToken],
  );

  const replace = useCallback(
    async (id: string, input: CreateMcpServerRequest) => {
      const updated = await mutatingRequest(
        `/api/mcp-servers/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          body: input,
          getCsrfToken: () => useUiStore.getState().csrfToken,
          refreshCsrfToken,
          responseSchema: mcpServerSummarySchema,
        },
      );
      setServers((prev) => prev.map((s) => (s.id === id ? updated : s)));
      return updated;
    },
    [refreshCsrfToken],
  );

  const patch = useCallback(
    async (id: string, input: UpdateMcpServerRequest) => {
      const updated = await mutatingRequest(
        `/api/mcp-servers/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: input,
          getCsrfToken: () => useUiStore.getState().csrfToken,
          refreshCsrfToken,
          responseSchema: mcpServerSummarySchema,
        },
      );
      setServers((prev) => prev.map((s) => (s.id === id ? updated : s)));
      return updated;
    },
    [refreshCsrfToken],
  );

  const remove = useCallback(
    async (id: string) => {
      await mutatingRequest(`/api/mcp-servers/${encodeURIComponent(id)}`, {
        method: "DELETE",
        getCsrfToken: () => useUiStore.getState().csrfToken,
        refreshCsrfToken,
      });
      setServers((prev) => prev.filter((s) => s.id !== id));
    },
    [refreshCsrfToken],
  );

  const revalidate = useCallback(
    async (id: string) => {
      const updated = await mutatingRequest(
        `/api/mcp-servers/${encodeURIComponent(id)}/revalidate`,
        {
          method: "POST",
          getCsrfToken: () => useUiStore.getState().csrfToken,
          refreshCsrfToken,
          responseSchema: mcpServerSummarySchema,
        },
      );
      setServers((prev) => prev.map((s) => (s.id === id ? updated : s)));
      return updated;
    },
    [refreshCsrfToken],
  );

  const reveal = useCallback(
    async (id: string) =>
      httpRequest(`/api/mcp-servers/${encodeURIComponent(id)}/reveal`, {
        responseSchema: mcpServerRevealResponseSchema,
      }),
    [],
  );

  // Mount-only hydration. Subsequent edits go through the helpers above.
  // The hook is exempt from the no-useEffect rule per the project's
  // ESLint config (hooks/** is allowed).
  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    servers,
    loading,
    error,
    reload,
    create,
    replace,
    patch,
    remove,
    revalidate,
    reveal,
  };
}
