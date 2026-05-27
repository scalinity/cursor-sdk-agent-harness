import { describe, expect, it } from "vitest";
import type { ServerFrame } from "@harness/shared";
import { createStreamBuffer, ingestStreamFrame, renderStreamItems } from "../../src/repl/StreamView.js";

const base = {
  id: "frame-123",
  sent_at: "2026-05-25T18:00:00.000Z",
};

describe("StreamView helpers", () => {
  it("accumulates assistant and thinking deltas", () => {
    let buffer = createStreamBuffer();
    buffer = ingestStreamFrame(buffer, {
      ...base,
      type: "sdk.assistant",
      event: {
        event_id: "00000000-0000-4000-8000-000000000001",
        schema_version: 1,
        seq: 1,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "assistant",
        kind: "assistant.delta",
        payload: { role: "assistant", text_delta: "Hello", is_replacement: false, tool_uses: [] },
      },
    } satisfies ServerFrame);
    buffer = ingestStreamFrame(buffer, {
      ...base,
      id: "frame-124",
      type: "sdk.thinking",
      event: {
        event_id: "00000000-0000-4000-8000-000000000002",
        schema_version: 1,
        seq: 2,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "thinking",
        kind: "thinking.delta",
        payload: { text_delta: "Checking files", full_text_length: 14, is_replacement: false },
      },
    } satisfies ServerFrame);

    const output = renderStreamItems(buffer.items);
    expect(output).toContain("Hello");
    expect(output).toContain("Thinking");
    expect(output).toContain("Checking files");
  });

  it("tracks tool calls, code edits, approvals, and run summaries", () => {
    let buffer = createStreamBuffer();
    buffer = ingestStreamFrame(buffer, {
      ...base,
      type: "sdk.tool_call",
      event: {
        event_id: "00000000-0000-4000-8000-000000000003",
        schema_version: 1,
        seq: 3,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "tool_call",
        kind: "tool_call.running",
        payload: { call_id: "call-1", name: "read_file", status: "running", args: { path: "auth.ts" } },
      },
    } satisfies ServerFrame);
    buffer = ingestStreamFrame(buffer, {
      ...base,
      id: "frame-125",
      type: "derived.code_edit",
      event: {
        event_id: "00000000-0000-4000-8000-000000000004",
        schema_version: 1,
        seq: 4,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "tool_call",
        kind: "code_edit.detected",
        payload: {
          source_call_id: "call-1",
          confidence: "high",
          edits: [{ path: "auth.ts", language: "typescript", unifiedDiff: "-old\n+new", operations: [] }],
        },
      },
    } satisfies ServerFrame);
    buffer = ingestStreamFrame(buffer, {
      ...base,
      id: "frame-126",
      type: "sdk.request",
      event: {
        event_id: "00000000-0000-4000-8000-000000000005",
        schema_version: 1,
        seq: 5,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "request",
        kind: "request.created",
        request_id: "req-1",
        payload: { request_id: "req-1", context_event_ids: [], inferred_reason: "edit auth.ts" },
      },
    } satisfies ServerFrame);
    buffer = ingestStreamFrame(buffer, {
      ...base,
      id: "frame-127",
      type: "run.final_result",
      event: {
        event_id: "00000000-0000-4000-8000-000000000006",
        schema_version: 1,
        seq: 6,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "status",
        kind: "run.final_result",
        status: "FINISHED",
        payload: { text: "done", duration_ms: 1200, usage: { input_tokens: 10, output_tokens: 20, cached_input_tokens: 0, reasoning_tokens: null, cost_usd_micros: 2500, usage_source: "sdk_final_result" } },
      },
    } satisfies ServerFrame);

    const output = renderStreamItems(buffer.items);
    expect(output).toContain("read auth.ts");
    expect(output).toContain("Approval required");
    expect(output).toContain("30 tokens");
    expect(output).toContain("$0.0025");
  });

  it("renders turn boundaries for user, assistant, and system items", () => {
    const out = renderStreamItems(
      [
        { type: "user", text: "fix the bug", at: "14:32" },
        { type: "assistant", text: "Done." },
        { type: "system", text: "Mode switched to agent." },
      ],
      40,
    );
    expect(out).toContain("── you · 14:32 ");
    expect(out).toContain("fix the bug");
    expect(out).toContain("── claude ──");
    expect(out).toContain("Done.");
    expect(out).toContain("Mode switched to agent.");
  });
});
