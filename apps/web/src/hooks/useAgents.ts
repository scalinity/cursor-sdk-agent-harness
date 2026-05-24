/**
 * useAgents — wraps `/api/agents`. Hydrates the agent-store on mount.
 *
 * Phase 08 only needs list + select + (lightly) create. CRUD beyond that
 * lands in later phases.
 *
 * Auto-select rule (RV2-W5): only fires on the FIRST reload AND only when
 * the user has not explicitly chosen an agent in this session. This means
 * a refetch after the user clears the picker no longer clobbers their
 * intent.
 *
 * Stale-time (RV2-S10): the hook also refetches when `lastFetchedAt` is
 * older than AGENT_STALE_MS, so other-tab activity surfaces without a
 * manual reload.
 *
 * AbortController (RV2-W5): the in-flight fetch is cancelled when the
 * component unmounts or a new reload supersedes it.
 */
import { useCallback, useEffect, useRef } from "react";
import {
  agentSummarySchema,
  listAgentsResponseSchema,
  type AgentSummary,
  type CreateAgentRequest,
} from "@harness/shared";
import { httpRequest, mutatingRequest } from "../lib/http-client.js";
import { useAgentStore } from "../state/agent-store.js";
import { useUiStore } from "../state/ui-store.js";
import { useCsrfToken } from "./useCsrfToken.js";

const AGENT_STALE_MS = 60_000;

export interface UseAgentsResult {
  agents: AgentSummary[];
  activeAgent: AgentSummary | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  selectAgent: (agentId: string | null) => void;
  createAgent: (request: CreateAgentRequest) => Promise<AgentSummary>;
  updateAgentModel: (agentId: string, modelId: string) => Promise<AgentSummary>;
  terminateAgent: (agentId: string) => Promise<void>;
}

/** Compare two ISO-8601 timestamps by their numeric Date value, descending. */
function compareIsoDesc(a: string | null, b: string | null): number {
  const at = a ? new Date(a).getTime() : 0;
  const bt = b ? new Date(b).getTime() : 0;
  return bt - at;
}

export function useAgents(): UseAgentsResult {
  const byId = useAgentStore((s) => s.byId);
  const ids = useAgentStore((s) => s.ids);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const loading = useAgentStore((s) => s.loading);
  const lastError = useAgentStore((s) => s.lastError);
  const lastFetchedAt = useAgentStore((s) => s.lastFetchedAt);
  const setAgents = useAgentStore((s) => s.setAgents);
  const upsertAgent = useAgentStore((s) => s.upsertAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const setActiveAgentId = useAgentStore((s) => s.setActiveAgentId);
  const setLoading = useAgentStore((s) => s.setLoading);
  const setLastError = useAgentStore((s) => s.setLastError);
  const setLastFetchedAt = useAgentStore((s) => s.setLastFetchedAt);
  const { refresh: refreshCsrfToken } = useCsrfToken();

  // Track the in-flight fetch so a later reload (or unmount) can cancel
  // it; without this, a navigation-during-fetch races the response and
  // hydrates a stale cache.
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    // Cancel any in-flight reload before starting a new one.
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;

    setLoading(true);
    setLastError(null);
    try {
      const res = await httpRequest("/api/agents", {
        responseSchema: listAgentsResponseSchema,
        signal: ctl.signal,
      });
      // Abort happened while awaiting — drop the response on the floor.
      if (ctl.signal.aborted) return;
      setAgents(res.items);
      setLastFetchedAt(Date.now());

      // Auto-select only on first hydration AND only when the user has
      // not made an explicit choice this session.
      const current = useAgentStore.getState();
      if (!current.hasUserSelected && !current.activeAgentId && res.items.length > 0) {
        const sorted = [...res.items].sort((a, b) =>
          compareIsoDesc(a.lastActiveAt ?? a.createdAt, b.lastActiveAt ?? b.createdAt),
        );
        setActiveAgentId(sorted[0]!.id);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (!ctl.signal.aborted) {
        setLastError(e instanceof Error ? e.message : "agents load failed");
      }
    } finally {
      if (abortRef.current === ctl) abortRef.current = null;
      setLoading(false);
    }
  }, [setAgents, setActiveAgentId, setLoading, setLastError, setLastFetchedAt]);

  const createAgent = useCallback(
    async (request: CreateAgentRequest): Promise<AgentSummary> => {
      const created = await mutatingRequest("/api/agents", {
        method: "POST",
        body: request,
        getCsrfToken: () => useUiStore.getState().csrfToken,
        refreshCsrfToken,
        responseSchema: agentSummarySchema,
      });
      upsertAgent(created);
      return created;
    },
    [refreshCsrfToken, upsertAgent],
  );

  const updateAgentModel = useCallback(
    async (agentId: string, modelId: string): Promise<AgentSummary> => {
      const updated = await mutatingRequest(
        `/api/agents/${encodeURIComponent(agentId)}`,
        {
          method: "PATCH",
          body: { modelId },
          getCsrfToken: () => useUiStore.getState().csrfToken,
          refreshCsrfToken,
          responseSchema: agentSummarySchema,
        },
      );
      upsertAgent(updated);
      return updated;
    },
    [refreshCsrfToken, upsertAgent],
  );

  const terminateAgent = useCallback(
    async (agentId: string) => {
      await mutatingRequest(`/api/agents/${encodeURIComponent(agentId)}/terminate`, {
        method: "POST",
        body: {},
        getCsrfToken: () => useUiStore.getState().csrfToken,
        refreshCsrfToken,
      });
      removeAgent(agentId);
    },
    [refreshCsrfToken, removeAgent],
  );

  // Mount hydration + stale-time refresh. Abort the active fetch on unmount.
  useEffect(() => {
    const fresh = lastFetchedAt && Date.now() - lastFetchedAt < AGENT_STALE_MS;
    if (ids.length === 0 || !fresh) {
      void reload();
    }
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [ids.length, lastFetchedAt, reload]);

  const agents: AgentSummary[] = ids.map((id) => byId[id]!).filter(Boolean);
  const activeAgent: AgentSummary | null = activeAgentId ? (byId[activeAgentId] ?? null) : null;

  return {
    agents,
    activeAgent,
    loading,
    error: lastError,
    reload,
    selectAgent: setActiveAgentId,
    createAgent,
    updateAgentModel,
    terminateAgent,
  };
}
