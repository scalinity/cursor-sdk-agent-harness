import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SubagentDashboard } from "./SubagentDashboard.js";

describe("SubagentDashboard", () => {
  afterEach(() => cleanup());

  it("renders summary counts, status badges, token totals, and event previews", () => {
    render(
      <SubagentDashboard
        activeCount={1}
        completedCount={1}
        subagents={[
          {
            runId: "subagent-a",
            name: "Reviewer A",
            status: "RUNNING",
            startedAt: "2026-05-25T12:00:00.000Z",
            completedAt: null,
            tokenCount: 128,
            costMicros: null,
            eventPreview: ["task.updated", "tool_call.running"],
            events: ["1 subagent.spawned RUNNING", "2 tool_call.running"],
          },
          {
            runId: "subagent-b",
            name: "Reviewer B",
            status: "FINISHED",
            startedAt: "2026-05-25T12:01:00.000Z",
            completedAt: "2026-05-25T12:02:00.000Z",
            tokenCount: 256,
            costMicros: 1400,
            eventPreview: ["task.updated", "run.final_result"],
            events: ["1 subagent.spawned RUNNING", "2 subagent.completed FINISHED"],
          },
        ]}
      />,
    );

    expect(screen.getByText("1 agent active, 1 completed")).not.toBeNull();
    expect(screen.getByText("384 tokens")).not.toBeNull();
    expect(screen.getByText("Reviewer A")).not.toBeNull();
    expect(screen.getByText("Reviewer B")).not.toBeNull();
    expect(screen.getByText("RUNNING")).not.toBeNull();
    expect(screen.getByText("FINISHED")).not.toBeNull();
    expect(screen.getByText("tool_call.running")).not.toBeNull();
    expect(screen.getByText("run.final_result")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Reviewer A/ }));
    expect(screen.getByText("1 subagent.spawned RUNNING")).not.toBeNull();
  });

  it("renders loading and retryable error states", () => {
    render(
      <SubagentDashboard
        activeCount={0}
        completedCount={0}
        subagents={[]}
        loading
        error="Failed to load sub-agents"
        onRetry={() => {}}
      />,
    );

    expect(screen.getByText("Loading sub-agents")).not.toBeNull();
    expect(screen.getByRole("alert")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).not.toBeNull();
  });
});
