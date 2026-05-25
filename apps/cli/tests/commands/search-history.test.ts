import { describe, expect, it, vi } from "vitest";
import { showHistory } from "../../src/commands/history.js";
import { searchWorkspace } from "../../src/commands/search.js";

describe("search and history commands", () => {
  it("prints grep results with file, line, and match", async () => {
    const lines: string[] = [];
    const http = {
      grepSearch: vi.fn(async () => ({ results: [{ path: "src/auth.ts", line: 12, column: 3, text: "const token = getToken();" }] })),
    };

    await searchWorkspace({ query: "token", maxResults: 10, filesOnly: false, json: false }, { http, write: (line) => lines.push(line) });

    expect(http.grepSearch).toHaveBeenCalledWith({ q: "token", maxResults: 10 });
    expect(lines.join("\n")).toContain("src/auth.ts:12");
    expect(lines.join("\n")).toContain("getToken");
  });

  it("prints run history table", async () => {
    const lines: string[] = [];
    const http = {
      listRuns: vi.fn(async () => ({
        items: [{
          id: "run-123456789",
          agentId: "agent-1",
          agentName: "CLI",
          name: null,
          status: "FINISHED",
          executionMode: "agent",
          promptPreview: "fix auth",
          modelId: "composer-2-5-fast",
          workspaceId: null,
          startedAt: "2026-05-25T18:00:00.000Z",
          finishedAt: "2026-05-25T18:00:03.000Z",
          durationMs: 3000,
          inputTokens: 10,
          outputTokens: 20,
          cachedInputTokens: 0,
          reasoningTokens: null,
          costUsdMicros: 1000,
          usageSource: "sdk_final_result",
          lastTurnInputTokens: 10,
          lastTurnOutputTokens: 20,
          toolCallCount: 1,
          errorToolCallCount: 0,
        }],
        total: 1,
      })),
    };

    await showHistory({ limit: 20, json: false }, { http, write: (line) => lines.push(line) });

    expect(http.listRuns).toHaveBeenCalledWith({ limit: 20 });
    expect(lines.join("\n")).toContain("run-1234");
    expect(lines.join("\n")).toContain("fix auth");
  });
});
