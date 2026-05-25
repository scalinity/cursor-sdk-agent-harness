import { describe, expect, it } from "vitest";
import type { CanonicalRunEventDraft } from "../normalizer.js";
import { detectSubagentSpawn } from "../subagent-detector.js";

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
