import { describe, expect, it } from "vitest";
import type { AgentSummary } from "@harness/shared";
import { chooseInitialAgentForAutoSelect } from "../useAgents.js";

function agent(
  id: string,
  status: AgentSummary["status"],
  createdAt: string,
  lastActiveAt: string | null = null,
): AgentSummary {
  return {
    id,
    name: id,
    status,
    modelId: "composer-2-5-fast",
    createdAt,
    lastActiveAt,
  } as AgentSummary;
}

describe("chooseInitialAgentForAutoSelect", () => {
  it("prefers the most recently active usable agent over newer non-active rows", () => {
    const chosen = chooseInitialAgentForAutoSelect([
      agent("creating-new", "creating", "2026-05-29T01:20:00.000Z"),
      agent("error-new", "error", "2026-05-29T01:19:00.000Z"),
      agent("active-old", "active", "2026-05-28T13:00:00.000Z", "2026-05-28T13:30:00.000Z"),
    ]);

    expect(chosen?.id).toBe("active-old");
  });

  it("falls back to the newest row when no active agents exist", () => {
    const chosen = chooseInitialAgentForAutoSelect([
      agent("error-old", "error", "2026-05-28T13:00:00.000Z"),
      agent("creating-new", "creating", "2026-05-29T01:20:00.000Z"),
    ]);

    expect(chosen?.id).toBe("creating-new");
  });

  it("returns null for an empty list", () => {
    expect(chooseInitialAgentForAutoSelect([])).toBeNull();
  });
});
