import { describe, expect, it } from "vitest";
import type { ServerFrame } from "@harness/shared";
import { createStreamBuffer, ingestStreamFrame, renderStreamItems, type StreamItem } from "../../src/repl/StreamView.js";

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

  it("tracks tool calls, code edits, approvals, and stores run summaries", () => {
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
        kind: "tool_call.completed",
        payload: { call_id: "call-1", name: "read_file", status: "completed", args: { path: "auth.ts" } },
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
    const summary = buffer.items.find((item): item is Extract<StreamItem, { type: "summary" }> => item.type === "summary");
    expect(output).toContain("read auth.ts");
    expect(output).toContain("Approval required");
    expect(output).toContain("30 tok");
    expect(output).toContain("turn $0.0025");
    expect(output).toContain("1.2s");
    expect(summary).toMatchObject({ status: "FINISHED", tokens: 30, tokensPartial: false, costMicros: 2500, costUnavailable: false });
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
    expect(out).toContain("── Gumbo ──");
    expect(out).toContain("Done.");
    expect(out).toContain("Mode switched to agent.");
  });

  it("renders running task tools immediately so parallel subagents are visible before completion", () => {
    let buffer = createStreamBuffer();
    const tasks = ["Review skills.ts correctness", "Review tests and conventions", "Review stream rendering"];

    for (const [index, task] of tasks.entries()) {
      buffer = ingestStreamFrame(buffer, {
        ...base,
        id: `frame-task-${index}`,
        type: "sdk.tool_call",
        event: {
          event_id: `00000000-0000-4000-8000-0000000001${index}1`,
          schema_version: 1,
          seq: index + 1,
          agent_id: "agent-1",
          run_id: "run-1",
          occurred_at: base.sent_at,
          received_at: base.sent_at,
          sdk_type: "tool_call",
          kind: "tool_call.running",
          payload: { call_id: `task-${index}`, name: "task", status: "running", args: { description: task } },
        },
      } satisfies ServerFrame);
    }

    const output = renderStreamItems(buffer.items);
    for (const task of tasks) {
      expect(output).toContain(`task ${task}`);
    }
  });

  it("renders subagent lifecycle frames with child identity and terminal status", () => {
    let buffer = createStreamBuffer();
    buffer = ingestStreamFrame(buffer, {
      ...base,
      id: "frame-subagent-spawned",
      type: "subagent_spawned",
      event: {
        event_id: "00000000-0000-4000-8000-000000000311",
        schema_version: 1,
        seq: 1,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "task",
        kind: "subagent.spawned",
        call_id: "task-review-scroll",
        status: "running",
        payload: {
          parent_run_id: "run-1",
          child_run_id: "subagent-scroll-review-1234567890abcdef",
          subagent_name: "scroll reviewer",
          source_call_id: "task-review-scroll",
          status: "RUNNING",
        },
      },
    } satisfies ServerFrame);
    buffer = ingestStreamFrame(buffer, {
      ...base,
      id: "frame-subagent-completed",
      type: "subagent_completed",
      event: {
        event_id: "00000000-0000-4000-8000-000000000312",
        schema_version: 1,
        seq: 2,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "task",
        kind: "subagent.completed",
        call_id: "task-review-scroll",
        status: "completed",
        payload: {
          parent_run_id: "run-1",
          child_run_id: "subagent-scroll-review-1234567890abcdef",
          subagent_name: "scroll reviewer",
          source_call_id: "task-review-scroll",
          status: "FINISHED",
          tool_calls: [
            { name: "glob", detail: "**/*", ok: true },
            { name: "read", detail: "StreamView.tsx", ok: true },
            { name: "shell", detail: "", ok: false },
          ],
        },
      },
    } satisfies ServerFrame);

    const output = renderStreamItems(buffer.items);
    expect(output).toContain("◆ subagent");
    expect(output).toContain("scroll reviewer");
    expect(output).toContain("▸ spawned");
    expect(output).toContain("✓ finished");
    expect(output).toContain("╭─");
    expect(output).toContain("╰─");
    // The completed card now lists the sub-agent's own tool calls.
    expect(output).toContain("glob **/*");
    expect(output).toContain("read StreamView.tsx");
    expect(output).toContain("shell");
  });

  it("shows an overflow footer when a sub-agent makes more tool calls than fit", () => {
    let buffer = createStreamBuffer();
    const toolCalls = Array.from({ length: 20 }, (_unused, index) => ({
      name: "read",
      detail: `file-${index}.ts`,
      ok: true,
    }));
    buffer = ingestStreamFrame(buffer, {
      ...base,
      id: "frame-subagent-overflow",
      type: "subagent_completed",
      event: {
        event_id: "00000000-0000-4000-8000-000000000313",
        schema_version: 1,
        seq: 1,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "task",
        kind: "subagent.completed",
        call_id: "task-overflow",
        status: "completed",
        payload: {
          parent_run_id: "run-1",
          child_run_id: "subagent-overflow-1234567890abcdef00",
          subagent_name: "explorer",
          source_call_id: "task-overflow",
          status: "FINISHED",
          tool_calls: toolCalls,
        },
      },
    } satisfies ServerFrame);

    const output = renderStreamItems(buffer.items);
    expect(output).toContain("+8 more (20 total)");
  });

  it("renders sdk.task progress text instead of dropping it", () => {
    let buffer = createStreamBuffer();
    buffer = ingestStreamFrame(buffer, {
      ...base,
      id: "frame-task-progress",
      type: "sdk.task",
      event: {
        event_id: "00000000-0000-4000-8000-000000000321",
        schema_version: 1,
        seq: 1,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "task",
        kind: "task.updated",
        status: "running",
        payload: { status: "running", text: "review agent is reading StreamView.tsx" },
      },
    } satisfies ServerFrame);

    const output = renderStreamItems(buffer.items);
    expect(output).toContain("task running");
    expect(output).toContain("review agent is reading StreamView.tsx");
  });

  it("renders running tools and marks them cancelled on interruption", () => {
    let buffer = createStreamBuffer();
    buffer = ingestStreamFrame(buffer, {
      ...base,
      type: "sdk.tool_call",
      event: {
        event_id: "00000000-0000-4000-8000-0000000000a1",
        schema_version: 1,
        seq: 1,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "tool_call",
        kind: "tool_call.running",
        payload: { call_id: "c1", name: "bash", status: "running", args: { command: "sleep 100" } },
      },
    } satisfies ServerFrame);
    expect(renderStreamItems(buffer.items)).toContain("shell sleep 100");
    buffer = ingestStreamFrame(buffer, {
      ...base,
      type: "run.interrupted",
      event: {
        event_id: "00000000-0000-4000-8000-0000000000a2",
        schema_version: 1,
        seq: 2,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "status",
        kind: "run.interrupted",
        payload: { reason: "user_cancelled" },
      },
    } satisfies ServerFrame);
    const out = renderStreamItems(buffer.items);
    expect(out).toContain("⏸");
    expect(out).toContain("shell sleep 100 (cancelled)");
  });

  it("marks running tools completed on terminal sdk.status fallback", () => {
    let buffer = createStreamBuffer();
    buffer = ingestStreamFrame(buffer, {
      ...base,
      type: "sdk.tool_call",
      event: {
        event_id: "00000000-0000-4000-8000-0000000000c1",
        schema_version: 1,
        seq: 1,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "tool_call",
        kind: "tool_call.running",
        payload: { call_id: "c1", name: "bash", status: "running", args: { command: "sleep 100" } },
      },
    } satisfies ServerFrame);
    buffer = ingestStreamFrame(buffer, {
      ...base,
      id: "frame-status-finished",
      type: "sdk.status",
      event: {
        event_id: "00000000-0000-4000-8000-0000000000c2",
        schema_version: 1,
        seq: 2,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "status",
        kind: "status.changed",
        status: "FINISHED",
        payload: { status: "FINISHED" },
      },
    } satisfies ServerFrame);

    const out = renderStreamItems(buffer.items);
    expect(out).toContain("✓");
    expect(out).toContain("shell sleep 100");
  });

  it("keeps a still-running tool visible when the run finishes without a terminal tool frame", () => {
    let buffer = createStreamBuffer();
    buffer = ingestStreamFrame(buffer, {
      ...base,
      type: "sdk.tool_call",
      event: {
        event_id: "00000000-0000-4000-8000-0000000000b1",
        schema_version: 1,
        seq: 1,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "tool_call",
        kind: "tool_call.running",
        payload: { call_id: "c1", name: "bash", status: "running", args: { command: "sleep 100" } },
      },
    } satisfies ServerFrame);
    expect(renderStreamItems(buffer.items)).toContain("shell sleep 100");
    buffer = ingestStreamFrame(buffer, {
      ...base,
      type: "run.final_result",
      event: {
        event_id: "00000000-0000-4000-8000-0000000000b2",
        schema_version: 1,
        seq: 2,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "status",
        kind: "run.final_result",
        status: "FINISHED",
        payload: { text: "done", duration_ms: 100, usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0, reasoning_tokens: null, cost_usd_micros: 0, usage_source: "sdk_final_result" } },
      },
    } satisfies ServerFrame);
    const out = renderStreamItems(buffer.items);
    expect(out).toContain("✓");
    expect(out).toContain("shell sleep 100");
  });

  it("normalizes the edit path in code-edit previews", () => {
    let buffer = createStreamBuffer();
    buffer = ingestStreamFrame(buffer, {
      ...base,
      type: "derived.code_edit",
      event: {
        event_id: "00000000-0000-4000-8000-0000000000c1",
        schema_version: 1,
        seq: 1,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "tool_call",
        kind: "code_edit.detected",
        payload: { source_call_id: "c1", confidence: "high", edits: [{ path: "/work/proj/src/x.ts", language: null, after: "const x = 1;\n", operations: [] }] },
      },
    } satisfies ServerFrame, "/work/proj");
    const out = renderStreamItems(buffer.items);
    expect(out).toContain("src/x.ts");
    expect(out).not.toContain("/work/proj/src/x.ts");
  });

  it("renders partial or unavailable finished-turn usage without exact-looking counters", () => {
    let buffer = createStreamBuffer();
    buffer = ingestStreamFrame(buffer, {
      ...base,
      id: "frame-partial-usage",
      type: "run.final_result",
      event: {
        event_id: "00000000-0000-4000-8000-000000000007",
        schema_version: 1,
        seq: 7,
        agent_id: "agent-1",
        run_id: "run-1",
        occurred_at: base.sent_at,
        received_at: base.sent_at,
        sdk_type: "status",
        kind: "run.final_result",
        status: "FINISHED",
        payload: { text: "done", duration_ms: 900, usage: { input_tokens: 10, output_tokens: null, cached_input_tokens: null, reasoning_tokens: null, cost_usd_micros: null, usage_source: "sdk_final_result" } },
      },
    } satisfies ServerFrame);

    const output = renderStreamItems(buffer.items);
    const summary = buffer.items.find((item): item is Extract<StreamItem, { type: "summary" }> => item.type === "summary");
    expect(output).toContain("partial 10 tok");
    expect(output).toContain("turn cost unavailable");
    expect(summary).toMatchObject({ tokens: 10, tokensPartial: true, costMicros: null, costUnavailable: true });
  });
});
