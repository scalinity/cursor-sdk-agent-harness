import { describe, expect, it, vi } from "vitest";
import { HarnessHttpClient } from "../../src/client/http.js";

const agentBase = {
  status: "active",
  mode: "local",
  executionMode: "agent",
  modelId: "composer-2-5-fast",
  runCount: 0,
  activeRunCount: 0,
  totalCostUsdMicros: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  lastActiveAt: null,
  createdAt: "2026-05-25T18:00:00.000Z",
  terminatedAt: null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("HarnessHttpClient contracts", () => {
  it("does not reuse active agents from another workspace", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/agents" && (init?.method ?? "GET") === "GET") {
        return json({ items: [{ ...agentBase, id: "agent-old", name: "Wrong workspace" }] });
      }
      if (url.pathname === "/api/agents/agent-old") {
        return json({ ...agentBase, id: "agent-old", name: "Wrong workspace", modelParams: null, cwd: ["/tmp/other"], settingSources: null, sandboxEnabled: null, cloudOptions: null, mcpServerIds: [], subagentDefinitionIds: [], latestRunId: null, latestRunStatus: null });
      }
      if (url.pathname === "/api/security/csrf-token") {
        return json({ token: "csrf-token" });
      }
      if (url.pathname === "/api/agents" && init?.method === "POST") {
        return json({ ...agentBase, id: "agent-new", name: "project CLI" }, 201);
      }
      throw new Error(`Unexpected ${init?.method ?? "GET"} ${url.pathname}`);
    }) as typeof fetch;
    const client = new HarnessHttpClient({ serverUrl: "http://127.0.0.1:4783", fetchImpl });

    const agent = await client.getOrCreateAgent({ workspace: "/tmp/project" });

    expect(agent.id).toBe("agent-new");
    const createCall = fetchImpl.mock.calls.find(([input, init]) => new URL(String(input)).pathname === "/api/agents" && init?.method === "POST");
    expect(createCall?.[1]?.headers).toMatchObject({ Origin: "http://127.0.0.1:5173", "X-CSRF-Token": "csrf-token" });
    expect(createCall?.[1]?.body).toBeTypeOf("string");
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      name: "project CLI",
      modelId: "composer-2-5-fast",
      mode: "local",
      cwd: ["/tmp/project"],
      mcpServerIds: [],
      subagentDefinitionIds: [],
    });
  });
});
