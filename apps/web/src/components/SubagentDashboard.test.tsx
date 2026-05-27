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
            tokenCountPartial: true,
            costMicros: null,
            lastEvents: [],
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
            tokenCountPartial: false,
            costMicros: 1400,
            lastEvents: [],
            eventPreview: ["task.updated", "run.final_result"],
            events: ["1 subagent.spawned RUNNING", "2 subagent.completed FINISHED"],
          },
        ]}
      />,
    );

    expect(screen.getByText("1 running, 1 completed — partial 384 tokens")).not.toBeNull();
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

  it("auto-collapses completed subagents to a summary line and expands on request", () => {
    render(
      <SubagentDashboard
        activeCount={0}
        completedCount={3}
        subagents={[
          {
            runId: "subagent-a",
            name: "Reviewer A",
            status: "FINISHED",
            startedAt: "2026-05-25T12:00:00.000Z",
            completedAt: "2026-05-25T12:00:10.000Z",
            tokenCount: 1000,
            tokenCountPartial: false,
            costMicros: null,
            lastEvents: [],
          },
          {
            runId: "subagent-b",
            name: "Reviewer B",
            status: "FINISHED",
            startedAt: "2026-05-25T12:00:00.000Z",
            completedAt: "2026-05-25T12:00:10.000Z",
            tokenCount: 800,
            tokenCountPartial: false,
            costMicros: null,
            lastEvents: [],
          },
          {
            runId: "subagent-c",
            name: "Reviewer C",
            status: "FINISHED",
            startedAt: "2026-05-25T12:00:00.000Z",
            completedAt: "2026-05-25T12:00:10.000Z",
            tokenCount: 656,
            tokenCountPartial: false,
            costMicros: null,
            lastEvents: [],
          },
        ]}
      />,
    );

    expect(screen.getByText("3 sub-agents completed (2,456 tokens)")).not.toBeNull();
    expect(screen.queryByText("Reviewer A")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /expand sub-agent dashboard/i }));
    expect(screen.getByText("Reviewer A")).not.toBeNull();
  });

  it("caps the visible grid at 12 cards and shows overflow", () => {
    render(
      <SubagentDashboard
        activeCount={13}
        completedCount={0}
        subagents={Array.from({ length: 14 }, (_, index) => ({
          runId: `subagent-${index}`,
          name: `Reviewer ${index}`,
          status: "RUNNING",
          startedAt: "2026-05-25T12:00:00.000Z",
          completedAt: null,
          tokenCount: 1,
          tokenCountPartial: true,
          costMicros: null,
          lastEvents: [],
        }))}
      />,
    );

    expect(screen.getAllByTestId("subagent-card")).toHaveLength(12);
    expect(screen.getByText("+2 more")).not.toBeNull();
  });

  it("keeps active collapsed summaries honest", () => {
    render(
      <SubagentDashboard
        activeCount={1}
        completedCount={0}
        totalTokens={42}
        subagents={[
          {
            runId: "subagent-active",
            name: "Reviewer Active",
            status: "RUNNING",
            startedAt: "2026-05-25T12:00:00.000Z",
            completedAt: null,
            tokenCount: 42,
            tokenCountPartial: true,
            costMicros: null,
            lastEvents: [],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /collapse sub-agent dashboard/i }));
    expect(screen.getByText("1 running, 0 completed — partial 42 tokens")).not.toBeNull();
  });

  it("expands to REST-backed last events when no live child event stream is present", () => {
    render(
      <SubagentDashboard
        activeCount={1}
        completedCount={0}
        subagents={[
          {
            runId: "subagent-rest",
            name: "Reviewer Rest",
            status: "RUNNING",
            startedAt: "2026-05-25T12:00:00.000Z",
            completedAt: null,
            tokenCount: 1,
            tokenCountPartial: true,
            costMicros: null,
            lastEvents: [
              {
                kind: "tool_call.running",
                summary: "read_file src/app.ts",
                timestamp: "2026-05-25T12:00:01.000Z",
              },
            ],
            events: [],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Reviewer Rest/ }));
    expect(screen.getAllByText("tool_call.running: read_file src/app.ts")).toHaveLength(2);
    expect(screen.queryByText("waiting for events")).toBeNull();
  });

  it("uses hook-provided elapsedMs when present", () => {
    render(
      <SubagentDashboard
        activeCount={1}
        completedCount={0}
        subagents={[
          {
            runId: "subagent-elapsed",
            name: "Reviewer Elapsed",
            status: "RUNNING",
            startedAt: "2026-05-25T12:00:00.000Z",
            completedAt: null,
            elapsedMs: 12_300,
            tokenCount: 1,
            tokenCountPartial: true,
            costMicros: null,
            lastEvents: [],
          },
        ]}
      />,
    );

    expect(screen.getByText("12s")).not.toBeNull();
  });
});
