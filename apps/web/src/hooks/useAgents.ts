/**
 * useAgents — wraps `/api/agents`. Hydrates the agent-store on mount.
 *
 * Phase 08 only needs list + select + (lightly) create. CRUD beyond that
 * lands in later phases.
 */
import { useCallback, useEffect } from "react";
import {
  agentSummarySchema,
  listAgentsResponseSchema,
  type AgentSummary,
  type CreateAgentRequest,
} from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useAgentStore } from "../state/agent-store.js";
import { useUiStore } from "../state/ui-store.js";

export interface UseAgentsResult {
  agents: AgentSummary[];
  activeAgent: AgentSummary | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  selectAgent: (agentId: string | null) => void;
  createAgent: (request: CreateAgentRequest) => Promise<AgentSummary>;
  terminateAgent: (agentId: string) => Promise<void>;
}

export function useAgents(): UseAgentsResult {
  const byId = useAgentStore((s) => s.byId);
  const ids = useAgentStore((s) => s.ids);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const loading = useAgentStore((s) => s.loading);
  const lastError = useAgentStore((s) => s.lastError);
  const setAgents = useAgentStore((s) => s.setAgents);
  const upsertAgent = useAgentStore((s) => s.upsertAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const setActiveAgentId = useAgentStore((s) => s.setActiveAgentId);
  const setLoading = useAgentStore((s) => s.setLoading);
  const setLastError = useAgentStore((s) => s.setLastError);
  const csrfToken = useUiStore((s) => s.csrfToken);

  const reload = useCallback(async () => {
    setLoading(true);
    setLastError(null);
    try {
      const res = await httpRequest("/api/agents", { responseSchema: listAgentsResponseSchema });
      setAgents(res.items);
      // Auto-select the most recently active agent if none chosen yet.
      const current = useAgentStore.getState();
      if (!current.activeAgentId && res.items.length > 0) {
        const sorted = [...res.items].sort((a, b) => {
          const at = a.lastActiveAt ?? a.createdAt;
          const bt = b.lastActiveAt ?? b.createdAt;
          return bt.localeCompare(at);
        });
        setActiveAgentId(sorted[0]!.id);
      }
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "agents load failed");
    } finally {
      setLoading(false);
    }
  }, [setAgents, setActiveAgentId, setLoading, setLastError]);

  const createAgent = useCallback(
    async (request: CreateAgentRequest): Promise<AgentSummary> => {
      const created = await httpRequest("/api/agents", {
        method: "POST",
        body: request,
        csrfToken,
        responseSchema: agentSummarySchema,
      });
      upsertAgent(created);
      return created;
    },
    [csrfToken, upsertAgent],
  );

  const terminateAgent = useCallback(
    async (agentId: string) => {
      await httpRequest(`/api/agents/${encodeURIComponent(agentId)}/terminate`, {
        method: "POST",
        body: {},
        csrfToken,
      });
      removeAgent(agentId);
    },
    [csrfToken, removeAgent],
  );

  useEffect(() => {
    if (ids.length > 0) return;
    void reload();
  }, [ids.length, reload]);

  const agents: AgentSummary[] = ids.map((id) => byId[id]!).filter(Boolean);
  const activeAgent: AgentSummary | null = activeAgentId ? byId[activeAgentId] ?? null : null;

  return {
    agents,
    activeAgent,
    loading,
    error: lastError,
    reload,
    selectAgent: setActiveAgentId,
    createAgent,
    terminateAgent,
  };
}
