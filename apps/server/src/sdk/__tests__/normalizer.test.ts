import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@harness/shared";
import { normalize, type RunContext } from "../normalizer.js";

const RUN_ID = "run-1";
const AGENT_ID = "agent-1";
const RECEIVED_AT = "2026-05-23T10:00:00.000Z";
const OCCURRED_AT = "2026-05-23T10:00:00.000Z";

function ctx(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: RUN_ID,
    agentId: AGENT_ID,
    agentMode: "local",
    receivedAt: RECEIVED_AT,
    occurredAt: OCCURRED_AT,
    previousAssistantText: "",
    previousThinkingText: "",
    ...overrides,
  };
}

describe("normalize — discriminant coverage", () => {
  it("normalises sdk.system to system.init with mode default", () => {
    const raw: SDKMessage = {
      type: "system",
      subtype: "init",
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      model: { id: "composer-2-5-fast" },
      tools: ["edit", "shell"],
    };
    const out = normalize({ raw, runContext: ctx() });
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({
      sdkType: "system",
      kind: "system.init",
      payload: {
        subtype: "init",
        model: { id: "composer-2-5-fast" },
        tools: ["edit", "shell"],
        mode: "local",
      },
    });
  });

  it("normalises sdk.user to user.message", () => {
    const raw: SDKMessage = {
      type: "user",
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      message: {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    };
    const out = normalize({ raw, runContext: ctx() });
    expect(out.events).toHaveLength(1);
    expect(out.events[0]?.kind).toBe("user.message");
    expect(out.events[0]?.payload).toEqual({
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("treats the first assistant payload as a delta of the whole string", () => {
    const raw: SDKMessage = {
      type: "assistant",
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
      },
    };
    const out = normalize({ raw, runContext: ctx() });
    expect(out.events[0]?.kind).toBe("assistant.delta");
    expect(out.events[0]?.payload).toMatchObject({
      role: "assistant",
      text_delta: "Hello",
      full_text_length: 5,
      is_replacement: false,
      tool_uses: [],
    });
    expect(out.textBufferUpdates.assistantText).toBe("Hello");
  });

  it("emits an assistant.delta with only the suffix when text appends", () => {
    const raw: SDKMessage = {
      type: "assistant",
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello, world" }],
      },
    };
    const out = normalize({
      raw,
      runContext: ctx({ previousAssistantText: "Hello" }),
    });
    expect(out.events[0]?.kind).toBe("assistant.delta");
    expect(out.events[0]?.payload).toMatchObject({
      text_delta: ", world",
      is_replacement: false,
    });
    expect(out.textBufferUpdates.assistantText).toBe("Hello, world");
  });

  it("emits an assistant.snapshot when the new text doesn't extend the previous one", () => {
    const raw: SDKMessage = {
      type: "assistant",
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "totally different content" }],
      },
    };
    const out = normalize({
      raw,
      runContext: ctx({ previousAssistantText: "Hello" }),
    });
    expect(out.events[0]?.kind).toBe("assistant.snapshot");
    expect(out.events[0]?.payload).toMatchObject({
      text_delta: "totally different content",
      is_replacement: true,
    });
  });

  it("extracts tool_uses from assistant content into the payload", () => {
    const raw: SDKMessage = {
      type: "assistant",
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "running shell" },
          { type: "tool_use", id: "tu-1", name: "shell", input: { cmd: "ls" } },
        ],
      },
    };
    const out = normalize({ raw, runContext: ctx() });
    const payload = out.events[0]?.payload as {
      tool_uses: Array<{ id: string; name: string; input: unknown }>;
    };
    expect(payload.tool_uses).toEqual([
      { id: "tu-1", name: "shell", input: { cmd: "ls" } },
    ]);
  });

  it("normalises thinking with delta/snapshot detection identical to assistant", () => {
    const first = normalize({
      raw: {
        type: "thinking",
        agent_id: AGENT_ID,
        run_id: RUN_ID,
        text: "thought 1",
      } as SDKMessage,
      runContext: ctx(),
    });
    expect(first.events[0]?.kind).toBe("thinking.delta");
    expect((first.events[0]?.payload as { text_delta: string }).text_delta).toBe(
      "thought 1",
    );

    const second = normalize({
      raw: {
        type: "thinking",
        agent_id: AGENT_ID,
        run_id: RUN_ID,
        text: "thought 1 extended",
      } as SDKMessage,
      runContext: ctx({ previousThinkingText: "thought 1" }),
    });
    expect(second.events[0]?.kind).toBe("thinking.delta");
    expect((second.events[0]?.payload as { text_delta: string }).text_delta).toBe(
      " extended",
    );

    const replacement = normalize({
      raw: {
        type: "thinking",
        agent_id: AGENT_ID,
        run_id: RUN_ID,
        text: "fresh thought",
      } as SDKMessage,
      runContext: ctx({ previousThinkingText: "thought 1" }),
    });
    expect(replacement.events[0]?.kind).toBe("thinking.snapshot");
    expect((replacement.events[0]?.payload as { is_replacement: boolean }).is_replacement).toBe(
      true,
    );
  });

  it("maps tool_call running/completed/error onto the right kinds", () => {
    const running = normalize({
      raw: {
        type: "tool_call",
        agent_id: AGENT_ID,
        run_id: RUN_ID,
        call_id: "c-1",
        name: "shell",
        status: "running",
        args: { cmd: "ls" },
      },
      runContext: ctx(),
    });
    expect(running.events[0]?.kind).toBe("tool_call.running");
    expect(running.events[0]?.callId).toBe("c-1");

    const completed = normalize({
      raw: {
        type: "tool_call",
        agent_id: AGENT_ID,
        run_id: RUN_ID,
        call_id: "c-1",
        name: "shell",
        status: "completed",
        result: "ok",
      },
      runContext: ctx(),
    });
    expect(completed.events[0]?.kind).toBe("tool_call.completed");

    const errored = normalize({
      raw: {
        type: "tool_call",
        agent_id: AGENT_ID,
        run_id: RUN_ID,
        call_id: "c-1",
        name: "shell",
        status: "error",
      },
      runContext: ctx(),
    });
    expect(errored.events[0]?.kind).toBe("tool_call.error");
  });

  it("emits a placeholder code_edit.detected after a completed edit tool_call", () => {
    const out = normalize({
      raw: {
        type: "tool_call",
        agent_id: AGENT_ID,
        run_id: RUN_ID,
        call_id: "c-2",
        name: "edit",
        status: "completed",
        args: { path: "src/foo.ts" },
        result: { value: { diffString: "--- a\n+++ b\n" } },
      },
      runContext: ctx(),
    });
    expect(out.events.map((e) => e.kind)).toEqual([
      "tool_call.completed",
      "code_edit.detected",
    ]);
    expect(out.events[1]?.payload).toMatchObject({
      source_call_id: "c-2",
      confidence: "low",
      edits: [],
    });
    expect(out.events[1]?.raw).toBeNull();
  });

  it("does NOT emit code_edit.detected for non-edit tool names", () => {
    const out = normalize({
      raw: {
        type: "tool_call",
        agent_id: AGENT_ID,
        run_id: RUN_ID,
        call_id: "c-3",
        name: "shell",
        status: "completed",
        result: { value: "ls output" },
      },
      runContext: ctx(),
    });
    expect(out.events).toHaveLength(1);
    expect(out.events[0]?.kind).toBe("tool_call.completed");
  });

  it("normalises sdk.status to status.changed and preserves the status literal", () => {
    const out = normalize({
      raw: {
        type: "status",
        agent_id: AGENT_ID,
        run_id: RUN_ID,
        status: "RUNNING",
        message: "go",
      },
      runContext: ctx(),
    });
    expect(out.events[0]?.kind).toBe("status.changed");
    expect(out.events[0]?.status).toBe("RUNNING");
    expect(out.events[0]?.payload).toEqual({ status: "RUNNING", message: "go" });
  });

  it("normalises sdk.task to task.updated with optional fields", () => {
    const out = normalize({
      raw: {
        type: "task",
        agent_id: AGENT_ID,
        run_id: RUN_ID,
        status: "in_progress",
        text: "doing the thing",
      },
      runContext: ctx(),
    });
    expect(out.events[0]?.kind).toBe("task.updated");
    expect(out.events[0]?.payload).toEqual({
      status: "in_progress",
      text: "doing the thing",
    });
  });

  it("normalises sdk.request to request.created with sparse payload (OQ-09)", () => {
    const out = normalize({
      raw: {
        type: "request",
        agent_id: AGENT_ID,
        run_id: RUN_ID,
        request_id: "req-1",
      },
      runContext: ctx(),
    });
    expect(out.events[0]?.kind).toBe("request.created");
    expect(out.events[0]?.requestId).toBe("req-1");
    expect(out.events[0]?.payload).toEqual({
      request_id: "req-1",
      context_event_ids: [],
      inferred_reason: null,
    });
  });
});

describe("normalize — invariants", () => {
  it("never mutates the input raw object", () => {
    const raw: SDKMessage = {
      type: "assistant",
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
      },
    };
    const before = JSON.stringify(raw);
    normalize({ raw, runContext: ctx() });
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("propagates receivedAt/occurredAt to every emitted draft", () => {
    const out = normalize({
      raw: {
        type: "tool_call",
        agent_id: AGENT_ID,
        run_id: RUN_ID,
        call_id: "c-1",
        name: "edit",
        status: "completed",
        result: { value: { diffString: "" } },
      },
      runContext: ctx({
        receivedAt: "2026-05-23T11:00:00.000Z",
        occurredAt: "2026-05-23T11:00:00.000Z",
      }),
    });
    for (const e of out.events) {
      expect(e.receivedAt).toBe("2026-05-23T11:00:00.000Z");
      expect(e.occurredAt).toBe("2026-05-23T11:00:00.000Z");
    }
  });
});
