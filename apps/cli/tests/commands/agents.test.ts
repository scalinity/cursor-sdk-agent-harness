import { describe, expect, it, vi } from "vitest";
import { createAgent, listAgents } from "../../src/commands/agents.js";

describe("agents commands", () => {
  it("prints a table for agents list", async () => {
    const lines: string[] = [];
    const http = {
      listAgents: vi.fn(async () => ({
        items: [
          {
            id: "agent-123456789",
            name: "Workspace Agent",
            status: "active",
            mode: "local",
            executionMode: "agent",
            modelId: "composer-2-5-fast",
            runCount: 3,
            activeRunCount: 0,
            totalCostUsdMicros: 2500,
            totalInputTokens: 10,
            totalOutputTokens: 20,
            lastActiveAt: "2026-05-25T18:00:00.000Z",
            createdAt: "2026-05-25T17:00:00.000Z",
            terminatedAt: null,
          },
        ],
      })),
    };

    await listAgents({ json: false }, { http, write: (line) => lines.push(line) });

    expect(lines.join("\n")).toContain("Workspace Agent");
    expect(lines.join("\n")).toContain("composer-2-5-fast");
    expect(lines.join("\n")).toContain("$0.0025");
  });

  it("creates an agent with the requested model, mode, and workspace", async () => {
    const lines: string[] = [];
    const http = {
      ensureCsrfToken: vi.fn(async () => "csrf"),
      createAgent: vi.fn(async (input: unknown) => ({
        id: "agent-1",
        name: "CLI",
        status: "active",
        mode: "local",
        executionMode: "agent",
        modelId: "composer-2-5",
        runCount: 0,
        activeRunCount: 0,
        totalCostUsdMicros: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        lastActiveAt: null,
        createdAt: "2026-05-25T18:00:00.000Z",
        terminatedAt: null,
        input,
      })),
    };

    await createAgent({ name: "CLI", model: "composer-2-5", mode: "agent", workspace: "/tmp/project", json: true }, { http, write: (line) => lines.push(line) });

    expect(http.createAgent).toHaveBeenCalledWith({
      name: "CLI",
      modelId: "composer-2-5",
      mode: "local",
      cwd: ["/tmp/project"],
    });
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ type: "agent_created", agent: { id: "agent-1" } });
  });
});
