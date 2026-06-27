import type { CliAgentSummary, CliMode } from "../types.js";

/**
 * Normalize a backend agent `executionMode` string to the CLI's two-valued
 * mode. The backend may carry modes the CLI doesn't model; everything that
 * isn't "ask" is treated as "agent".
 */
export function normalizeCliMode(value: string): CliMode {
  return value === "ask" ? "ask" : "agent";
}

/**
 * The single constructor for `CliAgentSummary`. Accepts any agent shape that
 * carries the four fields (an `AgentSummary` or `AgentDetailResponse`), so the
 * http client, the chat entry point, and the TUI all map through one place.
 */
export function toCliAgentSummary(agent: {
  id: string;
  name: string;
  modelId: string;
  executionMode: string;
}): CliAgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    modelId: agent.modelId,
    executionMode: normalizeCliMode(agent.executionMode),
  };
}
