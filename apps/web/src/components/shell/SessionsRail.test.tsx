import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSummary } from "@harness/shared";
import { SessionsRail } from "./SessionsRail.js";
import { useRunStore } from "../../state/run-store.js";

function fixtureRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "run-1",
    agentId: "agent-1",
    agentName: "Coding Agent",
    status: "FINISHED",
    promptPreview: "do the thing",
    modelId: "composer-2-5-fast",
    workspaceId: null,
    startedAt: "2026-05-24T17:00:00.000Z",
    finishedAt: "2026-05-24T17:01:00.000Z",
    durationMs: 60_000,
    inputTokens: 10,
    outputTokens: 20,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    costUsdMicros: 100,
    usageSource: "sdk_final_result",
    toolCallCount: 0,
    errorToolCallCount: 0,
    ...overrides,
  };
}

describe("SessionsRail", () => {
  beforeEach(() => {
    useRunStore.setState({ byId: {} });
  });
  afterEach(() => cleanup());

  it("shows a delete button on a terminal run and calls onDeleteRun without selecting it", () => {
    const onDeleteRun = vi.fn();
    const onSelectRun = vi.fn();
    render(
      <SessionsRail
        runs={[fixtureRun()]}
        activeRunId={null}
        onSelectRun={onSelectRun}
        onDeleteRun={onDeleteRun}
      />,
    );
    const del = screen.getByLabelText("Delete conversation");
    fireEvent.click(del);
    expect(onDeleteRun).toHaveBeenCalledWith("run-1");
    // The delete click must not bubble up to the row's select handler.
    expect(onSelectRun).not.toHaveBeenCalled();
  });

  it("does not show a delete button on an in-flight run", () => {
    render(
      <SessionsRail
        runs={[fixtureRun({ id: "run-live", status: "RUNNING", finishedAt: null })]}
        activeRunId={null}
        onSelectRun={vi.fn()}
        onDeleteRun={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Delete conversation")).toBeNull();
  });

  it("the header + button starts a new session", () => {
    const onNewSession = vi.fn();
    render(
      <SessionsRail
        runs={[]}
        activeRunId={null}
        onSelectRun={vi.fn()}
        onNewSession={onNewSession}
      />,
    );
    fireEvent.click(screen.getByLabelText("New session"));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });
});
