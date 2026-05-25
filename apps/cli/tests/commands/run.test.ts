import { describe, expect, it, vi } from "vitest";
import { runPrompt } from "../../src/commands/run.js";

describe("runPrompt", () => {
  it("creates a run, subscribes to the stream, and writes rendered output", async () => {
    const lines: string[] = [];
    const http = {
      ensureCsrfToken: vi.fn(async () => "csrf"),
      getOrCreateAgent: vi.fn(async () => ({ id: "agent-1", name: "CLI", modelId: "composer-2-5-fast", executionMode: "agent" })),
      createRun: vi.fn(async () => ({ runId: "run-1", agentId: "agent-1", status: "RUNNING", startedAt: "2026-05-25T18:00:00.000Z" })),
    };
    const stream = {
      subscribeToRun: vi.fn(async (_runId: string, onFrame: (frame: unknown) => void) => {
        onFrame({
          id: "frame-1",
          type: "sdk.assistant",
          sent_at: "2026-05-25T18:00:00.000Z",
          event: {
            event_id: "00000000-0000-4000-8000-000000000010",
            schema_version: 1,
            seq: 1,
            agent_id: "agent-1",
            run_id: "run-1",
            occurred_at: "2026-05-25T18:00:00.000Z",
            received_at: "2026-05-25T18:00:00.000Z",
            sdk_type: "assistant",
            kind: "assistant.delta",
            payload: { role: "assistant", text_delta: "hi", is_replacement: false, tool_uses: [] },
          },
        });
        onFrame({
          id: "frame-2",
          type: "run.final_result",
          sent_at: "2026-05-25T18:00:01.000Z",
          event: {
            event_id: "00000000-0000-4000-8000-000000000011",
            schema_version: 1,
            seq: 2,
            agent_id: "agent-1",
            run_id: "run-1",
            occurred_at: "2026-05-25T18:00:01.000Z",
            received_at: "2026-05-25T18:00:01.000Z",
            sdk_type: "status",
            kind: "run.final_result",
            status: "FINISHED",
            payload: { duration_ms: 1000, usage: { input_tokens: 1, output_tokens: 2, cached_input_tokens: 0, reasoning_tokens: null, cost_usd_micros: null, usage_source: "unavailable" } },
          },
        });
      }),
    };

    const code = await runPrompt({ prompt: "hello", json: false }, { http, stream, write: (line) => lines.push(line) });

    expect(code).toBe(0);
    expect(http.createRun).toHaveBeenCalledWith({ agentId: "agent-1", prompt: "hello", executionMode: "agent" });
    expect(stream.subscribeToRun).toHaveBeenCalledWith("run-1", expect.any(Function));
    expect(lines.join("\n")).toContain("hi");
    expect(lines.join("\n")).toContain("3 tokens");
  });

  it("emits JSONL when requested", async () => {
    const lines: string[] = [];
    const http = {
      ensureCsrfToken: vi.fn(async () => "csrf"),
      getOrCreateAgent: vi.fn(async () => ({ id: "agent-1", name: "CLI", modelId: "composer-2-5-fast", executionMode: "agent" })),
      createRun: vi.fn(async () => ({ runId: "run-1", agentId: "agent-1", status: "RUNNING", startedAt: "2026-05-25T18:00:00.000Z" })),
    };
    const stream = {
      subscribeToRun: vi.fn(async (_runId: string, onFrame: (frame: unknown) => void) => {
        onFrame({ id: "frame-1", type: "ack", sent_at: "2026-05-25T18:00:00.000Z", ack_for: "sub-1", ok: true });
      }),
    };

    await runPrompt({ prompt: "hello", json: true }, { http, stream, write: (line) => lines.push(line) });

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ type: "run_started", runId: "run-1" });
    expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({ type: "ack" });
  });
});
