import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "@harness/shared";
import { Composer, describeModel } from "./Composer.js";
import { useUiStore } from "../../state/ui-store.js";

function fixtureAgent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id: "agent-1",
    name: "Local agent",
    status: "active",
    mode: "local",
    modelId: "composer-2-5-fast",
    runCount: 0,
    activeRunCount: 0,
    totalCostUsdMicros: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    lastActiveAt: null,
    createdAt: "2026-05-24T17:00:00.000Z",
    terminatedAt: null,
    ...overrides,
  };
}

function resetUiStore(): void {
  useUiStore.setState({
    composerDraft: "",
    toasts: [],
    toastCounter: 0,
  });
}

describe("Composer", () => {
  beforeEach(() => {
    resetUiStore();
  });
  afterEach(() => {
    cleanup();
  });

  it("enables the textarea even without an active agent", () => {
    render(<Composer activeAgent={null} onSubmit={vi.fn()} />);
    const textarea = screen.getByRole("textbox");
    expect((textarea as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("shows the default model label when no agent is selected", () => {
    render(<Composer activeAgent={null} onSubmit={vi.fn()} />);
    // The pill renders the friendly label, not the raw enum id.
    expect(screen.getByText("Composer 2.5 Fast")).not.toBeNull();
  });

  it("shows the agent's model label when the model id is known", () => {
    render(
      <Composer
        activeAgent={fixtureAgent({ modelId: "composer-2-5" })}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("Composer 2.5")).not.toBeNull();
  });

  it("renders the raw modelId with an (unknown) hint when the harness map lacks an entry", () => {
    // Regression for the "model pill must surface the real model id" rule:
    // never fabricate a different model's name when the enum doesn't match.
    render(
      <Composer
        activeAgent={fixtureAgent({ modelId: "composer-3-future" })}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("composer-3-future (unknown)")).not.toBeNull();
  });

  it("pushes an info toast when Enter is pressed without an active agent", () => {
    useUiStore.setState({ composerDraft: "hello" });
    render(<Composer activeAgent={null} onSubmit={vi.fn()} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: "Enter" });
    const toasts = useUiStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.severity).toBe("info");
    expect(toasts[0]?.message).toMatch(/agent/i);
  });

  it("does not call onSubmit when Enter is pressed without an active agent", () => {
    useUiStore.setState({ composerDraft: "hello" });
    const onSubmit = vi.fn();
    render(<Composer activeAgent={null} onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onSubmit with the draft + agentId when Enter is pressed with an active agent", async () => {
    useUiStore.setState({ composerDraft: "hi there" });
    const onSubmit = vi.fn().mockResolvedValue("run-1");
    render(<Composer activeAgent={fixtureAgent()} onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    // submit() is async; flush microtasks.
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledWith({
      prompt: "hi there",
      agentId: "agent-1",
    });
  });

  it("disables the Send button until both an agent and a non-empty draft exist", () => {
    const { rerender } = render(
      <Composer activeAgent={null} onSubmit={vi.fn()} />,
    );
    const sendButton = (): HTMLButtonElement =>
      screen.getByRole("button", { name: /send/i }) as HTMLButtonElement;
    expect(sendButton().disabled).toBe(true);

    useUiStore.setState({ composerDraft: "hello" });
    rerender(<Composer activeAgent={null} onSubmit={vi.fn()} />);
    expect(sendButton().disabled).toBe(true); // still no agent

    rerender(<Composer activeAgent={fixtureAgent()} onSubmit={vi.fn()} />);
    expect(sendButton().disabled).toBe(false);
  });

  it("exposes the descriptive model context to assistive tech via aria-label", () => {
    render(
      <Composer activeAgent={fixtureAgent({ name: "Sandbox" })} onSubmit={vi.fn()} />,
    );
    // The visible text is just the short label; aria-label carries the full
    // "Model: X (set on agent Y)" sentence so screen readers don't lose context.
    const pill = screen.getByLabelText(/Model:.*set on agent Sandbox/);
    expect(pill).not.toBeNull();
  });
});

describe("describeModel", () => {
  it("returns the default-model description when no agent is supplied", () => {
    const result = describeModel(null);
    expect(result.modelLabel).toBe("Composer 2.5 Fast");
    expect(result.modelTitle).toMatch(/^Default model/);
  });

  it("returns the agent's known-model description", () => {
    const result = describeModel(fixtureAgent({ modelId: "composer-2-5", name: "Editor" }));
    expect(result.modelLabel).toBe("Composer 2.5");
    expect(result.modelTitle).toContain("Editor");
  });

  it("never fabricates a label for an unknown model id", () => {
    const result = describeModel(fixtureAgent({ modelId: "future-model-x" }));
    expect(result.modelLabel).toContain("future-model-x");
    expect(result.modelLabel).toContain("(unknown)");
  });
});
