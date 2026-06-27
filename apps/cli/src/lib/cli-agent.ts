import type { AgentSummary } from "@harness/shared";
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
 * The single constructor for `CliAgentSummary`. The `Pick<AgentSummary, …>`
 * input accepts both `AgentSummary` and `AgentDetailResponse` (their fields are
 * compatible) while keeping the compile-time check that callers pass a real
 * agent shape — not an arbitrary object with a stray `executionMode` string.
 * The http client, the chat entry point, and the TUI all map through here.
 */
export function toCliAgentSummary(
  agent: Pick<AgentSummary, "id" | "name" | "modelId" | "executionMode">,
): CliAgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    modelId: agent.modelId,
    executionMode: normalizeCliMode(agent.executionMode),
  };
}
