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
  loading: boolean;
  lastError: string | null;

  setAgents: (agents: AgentSummary[]) => void;
  upsertAgent: (agent: AgentSummary) => void;
  removeAgent: (agentId: string) => void;
  setActiveAgentId: (agentId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setLastError: (msg: string | null) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  byId: {},
  ids: [],
  activeAgentId: null,
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
  setActiveAgentId: (agentId) => set({ activeAgentId: agentId }),
  setLoading: (loading) => set({ loading }),
  setLastError: (msg) => set({ lastError: msg }),
}));
