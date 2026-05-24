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

  it("requires a confirming second click to delete, and never selects the run", () => {
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
    // First click arms only — the irreversible delete must not fire yet.
    fireEvent.click(del);
    expect(onDeleteRun).not.toHaveBeenCalled();
    // The same button now confirms on the second click.
    fireEvent.click(screen.getByLabelText("Click again to confirm delete"));
    expect(onDeleteRun).toHaveBeenCalledWith("run-1");
    // Neither click may bubble up to the row's select handler.
    expect(onSelectRun).not.toHaveBeenCalled();
  });

  it("keydown on the delete button does not bubble to row selection", () => {
    const onSelectRun = vi.fn();
    render(
      <SessionsRail
        runs={[fixtureRun()]}
        activeRunId={null}
        onSelectRun={onSelectRun}
        onDeleteRun={vi.fn()}
      />,
    );
    // Without stopPropagation on the button's onKeyDown, Enter here bubbles to
    // the row's onKeyDown and selects the run being deleted.
    fireEvent.keyDown(screen.getByLabelText("Delete conversation"), { key: "Enter" });
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
