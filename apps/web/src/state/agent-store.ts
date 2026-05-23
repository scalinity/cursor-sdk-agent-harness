/**
 * Agent store — the agent picker's cache. Components subscribe to
 * `byId`/`activeAgentId` via selectors. Mutations flow through `useAgents`.
 */
import type { AgentSummary } from "@harness/shared";
import { create } from "zustand";

export interface AgentState {
  byId: Record<string, AgentSummary>;
  ids: string[];
  activeAgentId: string | null;
  /**
   * Set to true the first time the user explicitly chooses an agent via the
   * picker (or any external `setActiveAgentId` with a non-null value).
   * `useAgents.reload` consults this to avoid clobbering an explicit selection
   * with auto-select when a refetch fires after the user cleared the picker.
   */
  hasUserSelected: boolean;
  /** Epoch ms of the last successful agent list fetch (RV2-S10 stale-time). */
  lastFetchedAt: number | null;
  loading: boolean;
  lastError: string | null;

  setAgents: (agents: AgentSummary[]) => void;
  upsertAgent: (agent: AgentSummary) => void;
  removeAgent: (agentId: string) => void;
  setActiveAgentId: (agentId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setLastError: (msg: string | null) => void;
  setLastFetchedAt: (ts: number | null) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  byId: {},
  ids: [],
  activeAgentId: null,
  hasUserSelected: false,
  lastFetchedAt: null,
  loading: false,
  lastError: null,

  setAgents: (agents) => {
    const byId: Record<string, AgentSummary> = {};
    const ids: string[] = [];
    for (const a of agents) {
      byId[a.id] = a;
      ids.push(a.id);
    }
    set({ byId, ids });
  },
  upsertAgent: (agent) =>
    set((s) => {
      const exists = s.byId[agent.id];
      return {
        byId: { ...s.byId, [agent.id]: agent },
        ids: exists ? s.ids : [agent.id, ...s.ids],
      };
    }),
  removeAgent: (agentId) =>
    set((s) => {
      const { [agentId]: _removed, ...rest } = s.byId;
      void _removed;
      return {
        byId: rest,
        ids: s.ids.filter((id) => id !== agentId),
        activeAgentId: s.activeAgentId === agentId ? null : s.activeAgentId,
      };
    }),
  setActiveAgentId: (agentId) =>
    set((s) => ({
      activeAgentId: agentId,
      // Any explicit selection (including manual clear-and-reselect) flips
      // the flag so future auto-selects don't override the user's intent.
      hasUserSelected: agentId !== null ? true : s.hasUserSelected,
    })),
  setLoading: (loading) => set({ loading }),
  setLastError: (msg) => set({ lastError: msg }),
  setLastFetchedAt: (ts) => set({ lastFetchedAt: ts }),
}));
