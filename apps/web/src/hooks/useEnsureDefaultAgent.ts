/**
 * useEnsureDefaultAgent — removes the "create an agent before you can do
 * anything" friction. The harness auto-provisions a single default "Coding
 * Agent" for the active workspace, wired with EVERY configured MCP server and
 * EVERY subagent definition ("universal"), running the model the user picked
 * in the composer.
 *
 * Invariant enforced: the active agent's model always equals the composer's
 * `selectedModelId`. When it doesn't (cold start → no agent, or the user
 * switched the model dropdown), we find-or-create the default agent for that
 * model and select it. Matching `selectedModelId` is what keeps this from
 * fighting the advanced "New agent" dialog: a custom agent on the same model
 * already satisfies the invariant, so we leave it alone.
 *
 * Default agents are tracked in a localStorage map keyed by
 * `${workspaceId}::${modelId}` so the choice survives reloads and is scoped
 * per workspace (AgentSummary doesn't expose `cwd`, so we can't match on it).
 * If that mapping is ever lost we simply create a fresh default agent — at
 * worst a harmless duplicate, never a run against the wrong workspace.
 *
 * Effects live here (not in a component) per the repo's no-useEffect rule.
 */
import { useCallback, useEffect, useRef } from "react";
import {
  listMcpServersResponseSchema,
  listSubagentsResponseSchema,
  MODEL_LABELS,
  type AgentSummary,
  type CreateAgentRequest,
  type ModelId,
} from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useErrorReporter } from "./useErrorReporter.js";

const DEFAULT_AGENT_MAP_KEY = "harness:defaultAgentIds";

function defaultAgentName(modelId: ModelId): string {
  return `Coding Agent (${MODEL_LABELS[modelId]})`;
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
  modelId: ModelId;
  agents: AgentSummary[];
  activeAgent: AgentSummary | null;
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
    if (!activeWorkspaceId || !workspacePath) return;
    // The invariant already holds — the active agent runs the selected model.
    if (activeAgent && activeAgent.modelId === modelId) return;

    const mapKey = `${activeWorkspaceId}::${modelId}`;

    // Prefer the remembered default agent for this (workspace, model).
    const remembered = readDefaultAgentMap()[mapKey];
    const existing = remembered
      ? (agents.find(
          (a) => a.id === remembered && a.status === "active" && a.modelId === modelId,
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
          sandboxEnabled: true,
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
    activeAgent,
    agents,
    createAgent,
    selectAgent,
    fetchUniversalIds,
    report,
  ]);
}
