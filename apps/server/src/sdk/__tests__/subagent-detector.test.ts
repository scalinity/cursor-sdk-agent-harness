import { describe, expect, it } from "vitest";
import type { CanonicalRunEventDraft } from "../normalizer.js";
import { detectSubagentSpawn, extractSubagentToolCalls } from "../subagent-detector.js";

const BASE_EVENT: CanonicalRunEventDraft = {
  sdkType: "tool_call",
  kind: "tool_call.running",
  callId: "call-1",
  requestId: null,
  status: "running",
  payload: {
    call_id: "call-1",
    name: "mcp",
    status: "running",
    args: {
      providerIdentifier: "reviewer-agent",
      toolName: "run",
    },
  },
  raw: null,
  occurredAt: "2026-05-25T12:00:00.000Z",
  receivedAt: "2026-05-25T12:00:00.000Z",
};

describe("detectSubagentSpawn", () => {
  it("detects MCP tool calls whose provider identifier names an agent", () => {
    expect(detectSubagentSpawn(BASE_EVENT, { parentRunId: "run-parent" })).toEqual({
      name: "reviewer-agent",
      callId: "call-1",
      parentRunId: "run-parent",
    });
  });

  it("ignores non-subagent MCP calls", () => {
    expect(
      detectSubagentSpawn(
        {
          ...BASE_EVENT,
          payload: {
            call_id: "call-2",
            name: "mcp",
            status: "running",
            args: { providerIdentifier: "filesystem", toolName: "read_file" },
          },
        },
        { parentRunId: "run-parent" },
      ),
    ).toBeNull();
  });

  it("uses configured subagent names even when the provider itself is generic", () => {
    expect(
      detectSubagentSpawn(
        {
          ...BASE_EVENT,
          callId: "call-3",
          payload: {
            call_id: "call-3",
            name: "mcp",
            status: "running",
            args: { providerIdentifier: "custom-provider", toolName: "launch" },
          },
        },
        { parentRunId: "run-parent", configuredSubagentNames: ["custom-provider"] },
      ),
    ).toEqual({
      name: "custom-provider",
      callId: "call-3",
      parentRunId: "run-parent",
    });
  });
});

describe("extractSubagentToolCalls", () => {
  // Shape mirrors the verified completed `task` result (ledger OQ-32):
  // result.value.conversationSteps[] with thinking/assistant/toolCall steps,
  // each toolCall a oneof keyed `<name>ToolCall`.
  function result(steps: unknown[]): unknown {
    return { status: "success", value: { conversationSteps: steps } };
  }

  it("extracts a compact summary per toolCall step, skipping thinking/assistant", () => {
    const out = extractSubagentToolCalls(
      result([
        { thinkingMessage: { text: "planning", durationMs: 3 } },
        { assistantMessage: { text: "exploring" } },
        { toolCall: { globToolCall: { args: { targetDirectory: "/x", globPattern: "**/*" }, result: { success: {} } } } },
        { toolCall: { readToolCall: { args: { path: "/Users/danny/.claude/skills/benchmark/SKILL.md" }, result: { success: {} } } } },
        { toolCall: { grepToolCall: { args: { pattern: "skill|prompt" }, result: { success: {} } } } },
      ]),
    );
    expect(out).toEqual([
      { name: "glob", detail: "**/*", ok: true },
      { name: "read", detail: "SKILL.md", ok: true },
      { name: "grep", detail: "skill|prompt", ok: true },
    ]);
  });

  it("marks a tool call failed when the result is not the success variant", () => {
    const out = extractSubagentToolCalls(
      result([{ toolCall: { shellToolCall: { args: {}, result: { permissionDenied: {} } } } }]),
    );
    expect(out).toEqual([{ name: "shell", detail: "", ok: false }]);
  });

  it("shows the full command for shell-style details and the basename for paths", () => {
    const out = extractSubagentToolCalls(
      result([
        { toolCall: { shellToolCall: { args: { command: "ls -la /tmp" }, result: { success: {} } } } },
        { toolCall: { editToolCall: { args: { path: "/a/b/c/file.ts" }, result: { success: {} } } } },
      ]),
    );
    expect(out).toEqual([
      { name: "shell", detail: "ls -la /tmp", ok: true },
      { name: "edit", detail: "file.ts", ok: true },
    ]);
  });

  it("returns [] for a running task (no result), a non-transcript shape, or junk", () => {
    expect(extractSubagentToolCalls(undefined)).toEqual([]);
    expect(extractSubagentToolCalls({ status: "success" })).toEqual([]);
    expect(extractSubagentToolCalls({ value: { conversationSteps: "nope" } })).toEqual([]);
    expect(extractSubagentToolCalls("string")).toEqual([]);
  });

  it("caps extraction at 500 entries", () => {
    const steps = Array.from({ length: 600 }, () => ({
      toolCall: { readToolCall: { args: { path: "/a/f" }, result: { success: {} } } },
    }));
    expect(extractSubagentToolCalls(result(steps))).toHaveLength(500);
  });
});
