/**
 * useMcpServers — wraps `/api/mcp-servers`. Lists, creates, replaces,
 * deletes, and re-validates MCP server definitions. The list endpoint
 * returns redacted configs; the editor fetches raw values via the
 * per-server reveal endpoint.
 *
 * Spec §5 MCP Server CRUD; phase 12.
 */
import { useCallback, useState } from "react";
import {
  listMcpServersResponseSchema,
  mcpServerRevealResponseSchema,
  mcpServerSummarySchema,
  type CreateMcpServerRequest,
  type McpServerRevealResponse,
  type McpServerSummary,
  type UpdateMcpServerRequest,
} from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useMountEffect } from "./useMountEffect.js";
import { useMutatingRequest } from "./useMutatingRequest.js";

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
  const mutate = useMutatingRequest();

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
      const created = await mutate("/api/mcp-servers", {
        method: "POST",
        body: input,
        responseSchema: mcpServerSummarySchema,
      });
      setServers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      return created;
    },
    [mutate],
  );

  const replace = useCallback(
    async (id: string, input: CreateMcpServerRequest) => {
      const updated = await mutate(`/api/mcp-servers/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: input,
        responseSchema: mcpServerSummarySchema,
      });
      setServers((prev) => prev.map((s) => (s.id === id ? updated : s)));
      return updated;
    },
    [mutate],
  );

  const patch = useCallback(
    async (id: string, input: UpdateMcpServerRequest) => {
      const updated = await mutate(`/api/mcp-servers/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: input,
        responseSchema: mcpServerSummarySchema,
      });
      setServers((prev) => prev.map((s) => (s.id === id ? updated : s)));
      return updated;
    },
    [mutate],
  );

  const remove = useCallback(
    async (id: string) => {
      await mutate(`/api/mcp-servers/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setServers((prev) => prev.filter((s) => s.id !== id));
    },
    [mutate],
  );

  const revalidate = useCallback(
    async (id: string) => {
      const updated = await mutate(
        `/api/mcp-servers/${encodeURIComponent(id)}/revalidate`,
        {
          method: "POST",
          responseSchema: mcpServerSummarySchema,
        },
      );
      setServers((prev) => prev.map((s) => (s.id === id ? updated : s)));
      return updated;
    },
    [mutate],
  );

  const reveal = useCallback(
    async (id: string) =>
      mutate(`/api/mcp-servers/${encodeURIComponent(id)}/reveal`, {
        method: "POST",
        responseSchema: mcpServerRevealResponseSchema,
      }),
    [mutate],
  );

  // REVIEW-S7: explicit mount-only hydration via useMountEffect wrapper.
  // Subsequent edits go through the helpers above.
  useMountEffect(() => {
    void reload();
  });

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
