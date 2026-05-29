/**
 * useEnsureDefaultAgent — removes the "create an agent before you can do
 * anything" friction. The harness auto-provisions a single default "Coding
 * Agent" for the active workspace, wired with EVERY configured MCP server and
 * EVERY subagent definition ("universal"), running the model the user picked
 * in the composer.
 *
 * Invariant enforced: the active agent is the managed default for the active
 * `(workspaceId, selectedModelId)` pair. When it isn't — cold start (no agent),
 * the user switched the model dropdown, OR the user switched the active
 * workspace and the prior workspace's default is still selected — we
 * find-or-create the default agent for that pair and select it. An explicitly
 * chosen *custom* agent (one not in the managed-defaults map) running the
 * selected model is left alone, so this never fights the advanced "New agent"
 * dialog.
 *
 * Default agents are tracked in a localStorage map keyed by
 * `${workspaceId}::${modelId}` so the choice survives reloads and is scoped
 * per workspace (AgentSummary doesn't expose `cwd`, so we can't match on it);
 * the map's values are also the set of ids we treat as "managed". If that
 * mapping is ever lost we simply create a fresh default agent — at worst a
 * harmless duplicate, never a run against the wrong workspace.
 *
 * Effects live here (not in a component) per the repo's no-useEffect rule.
 */
import { useCallback, useEffect, useRef } from "react";
import {
  formatModelLabel,
  listMcpServersResponseSchema,
  listSubagentsResponseSchema,
  type AgentSummary,
  type CreateAgentRequest,
} from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useErrorReporter } from "./useErrorReporter.js";

const DEFAULT_AGENT_MAP_KEY = "harness:defaultAgentIds";

function defaultAgentName(modelId: string): string {
  return `Coding Agent (${formatModelLabel(modelId)})`;
}

function readDefaultAgentMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DEFAULT_AGENT_MAP_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeDefaultAgentId(mapKey: string, agentId: string): void {
  if (typeof window === "undefined") return;
  try {
    const next = { ...readDefaultAgentMap(), [mapKey]: agentId };
    window.localStorage.setItem(DEFAULT_AGENT_MAP_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode) — provisioning still works this
    // session; we just can't remember the agent across reloads.
  }
}

export interface UseEnsureDefaultAgentInput {
  activeWorkspaceId: string | null;
  workspacePath: string | null;
  modelId: string;
  agents: AgentSummary[];
  activeAgent: AgentSummary | null;
  agentsLoaded: boolean;
  createAgent: (request: CreateAgentRequest) => Promise<AgentSummary>;
  selectAgent: (agentId: string | null) => void;
}

export function useEnsureDefaultAgent(input: UseEnsureDefaultAgentInput): void {
  const {
    activeWorkspaceId,
    workspacePath,
    modelId,
    agents,
    activeAgent,
    agentsLoaded,
    createAgent,
    selectAgent,
  } = input;
  const { report } = useErrorReporter("default-agent");

  // Guards a create in flight, keyed by mapKey, so re-renders during the
  // async POST don't spawn duplicate agents.
  const creatingRef = useRef<string | null>(null);

  // Fetch the full current MCP + subagent id lists at provision time so the
  // default agent is wired with everything — no dependency on hook load
  // ordering, no stale empty set.
  const fetchUniversalIds = useCallback(async (): Promise<{
    mcpServerIds: string[];
    subagentDefinitionIds: string[];
  }> => {
    const [mcp, subs] = await Promise.all([
      httpRequest("/api/mcp-servers", { responseSchema: listMcpServersResponseSchema }),
      httpRequest("/api/subagents", { responseSchema: listSubagentsResponseSchema }),
    ]);
    return {
      mcpServerIds: mcp.items.map((s) => s.id),
      subagentDefinitionIds: subs.items.map((s) => s.id),
    };
  }, []);

  useEffect(() => {
    if (!agentsLoaded || !activeWorkspaceId || !workspacePath) return;

    // Re-provision when the active agent isn't the managed default for THIS
    // (workspace, model). Matching on model alone would ignore a workspace
    // switch — the prior workspace's default still runs the selected model, so
    // runs would keep executing against its cwd. We bind the invariant to the
    // (workspace, model) pair via the remembered-defaults map.
    const mapKey = `${activeWorkspaceId}::${modelId}`;
    const defaultsMap = readDefaultAgentMap();
    const rememberedForKey = defaultsMap[mapKey];
    const managedDefaultIds = new Set(Object.values(defaultsMap));

    // Invariant holds: the active agent is exactly this (workspace, model)'s
    // managed default and is ready to run. A remembered id that landed in
    // `error` (e.g. a transient NetworkError during Agent.create) must not
    // short-circuit provisioning — that left the composer "ready" while sends
    // failed and no fresh default was minted.
    if (
      activeAgent &&
      activeAgent.status === "active" &&
      activeAgent.id === rememberedForKey &&
      activeAgent.modelId === modelId
    ) {
      return;
    }

    // Respect an explicitly-chosen *custom* agent (one we don't manage — e.g.
    // from the New Agent dialog) running the selected model: don't yank it out
    // from under the user when the workspace pointer moves. In private-mode
    // browsers localStorage is unavailable, so the map is empty and every agent
    // looks "custom"; workspace-switch re-binding then degrades to the prior
    // model-only behaviour, which is acceptable for that edge.
    if (
      activeAgent &&
      activeAgent.status === "active" &&
      activeAgent.modelId === modelId &&
      !managedDefaultIds.has(activeAgent.id)
    ) {
      return;
    }

    // Otherwise — cold start, model switch, or a workspace switch that left a
    // different workspace's default active — find or create this (workspace,
    // model)'s default and select it.
    const existing = rememberedForKey
      ? (agents.find(
          (a) => a.id === rememberedForKey && a.status === "active" && a.modelId === modelId,
        ) ?? null)
      : null;
    if (existing) {
      writeDefaultAgentId(mapKey, existing.id);
      selectAgent(existing.id);
      return;
    }

    if (creatingRef.current === mapKey) return;
    creatingRef.current = mapKey;
    void (async () => {
      try {
        const universal = await fetchUniversalIds();
        const created = await createAgent({
          name: defaultAgentName(modelId),
          mode: "local",
          modelId,
          cwd: [workspacePath],
          settingSources: ["project", "user"],
          mcpServerIds: universal.mcpServerIds,
          subagentDefinitionIds: universal.subagentDefinitionIds,
        });
        writeDefaultAgentId(mapKey, created.id);
        selectAgent(created.id);
      } catch (e) {
        report(e);
      } finally {
        if (creatingRef.current === mapKey) creatingRef.current = null;
      }
    })();
  }, [
    activeWorkspaceId,
    workspacePath,
    modelId,
    agentsLoaded,
    activeAgent,
    agents,
    createAgent,
    selectAgent,
    fetchUniversalIds,
    report,
  ]);
}
