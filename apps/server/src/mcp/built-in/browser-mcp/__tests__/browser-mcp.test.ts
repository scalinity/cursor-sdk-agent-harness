import { afterEach, describe, expect, it } from "vitest";
import { startBrowserMcpServer, type BrowserMcpServer } from "../index.js";

let server: BrowserMcpServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe("built-in browser MCP server auth boundary", () => {
  it("keeps the logged base URL token-free and requires the per-agent capability token", async () => {
    server = await startBrowserMcpServer();

    expect(server.baseUrl).not.toContain("capability");
    const agentUrl = server.urlForAgent("agent 1");
    expect(agentUrl).toMatch(/\/mcp\/agent%201\?capability=/);

    const missing = await fetch(`${server.baseUrl}/mcp/agent%201`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(missing.status).toBe(401);

    const bad = await fetch(`${server.baseUrl}/mcp/agent%201?capability=bad`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(bad.status).toBe(403);

    const valid = await fetch(agentUrl, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    expect(valid.status).not.toBe(401);
    expect(valid.status).not.toBe(403);
  });
});
