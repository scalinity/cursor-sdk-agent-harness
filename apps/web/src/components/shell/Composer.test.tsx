import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "@harness/shared";
import { Composer } from "./Composer.js";
import { describeModel } from "../../lib/model-label.js";
import { useUiStore } from "../../state/ui-store.js";

function fixtureAgent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id: "agent-1",
    name: "Local agent",
    status: "active",
    mode: "local",
    executionMode: "agent",
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
    selectedModelId: "composer-2-5-fast",
    toasts: [],
    toastCounter: 0,
  });
}

describe("Composer", () => {
  beforeEach(() => {
    resetUiStore();
    // useModels() fetches /api/models on mount; stub it so the selector falls
    // back to the built-in Cursor model baseline (no real network).
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], autoAvailable: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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

  it("shows the selected model label on the picker", () => {
    useUiStore.setState({ selectedModelId: "composer-2-5" });
    render(<Composer activeAgent={fixtureAgent({ modelId: "composer-2-5" })} onSubmit={vi.fn()} />);
    expect(screen.getByText("Composer 2.5")).not.toBeNull();
  });

  it("renders an accessible model picker exposing both Composer models", () => {
    render(<Composer activeAgent={fixtureAgent()} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    const optionLabels = screen
      .getAllByRole("option")
      .map((o) => o.textContent?.trim());
    expect(optionLabels).toContain("Composer 2.5 Fast");
    expect(optionLabels).toContain("Composer 2.5");
  });

  it("switching the model dropdown updates the selected model in the store", () => {
    render(<Composer activeAgent={fixtureAgent()} onSubmit={vi.fn()} />);
    expect(useUiStore.getState().selectedModelId).toBe("composer-2-5-fast");
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    fireEvent.click(screen.getByRole("option", { name: "Composer 2.5" }));
    expect(useUiStore.getState().selectedModelId).toBe("composer-2-5");
  });

  it("keeps Send disabled until the active agent matches the selected model", () => {
    // The user picked composer-2-5 but the active (auto-provisioned) agent is
    // still on the fast model — sending now would run the wrong model, so the
    // composer waits for provisioning to land.
    useUiStore.setState({ composerDraft: "hi", selectedModelId: "composer-2-5" });
    render(
      <Composer
        activeAgent={fixtureAgent({ modelId: "composer-2-5-fast" })}
        onSubmit={vi.fn()}
      />,
    );
    const sendButton = screen.getByRole("button", { name: /send/i }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
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

  it("renders the icon Send button and a mic dictation button", () => {
    render(<Composer activeAgent={fixtureAgent()} onSubmit={vi.fn()} />);
    // Send is now an icon button but keeps its accessible name.
    const send = screen.getByRole("button", { name: /send/i });
    expect(send.className).toContain("composer-send");
    // A mic button sits beside it. Voice APIs are absent under jsdom, so it is
    // present-but-disabled rather than missing.
    const mic = screen.getByRole("button", { name: /record voice input/i }) as HTMLButtonElement;
    expect(mic.className).toContain("composer-mic");
    expect(mic.disabled).toBe(true);
  });

  it("R17-W6: caps image attachments at 16 and warns on overflow", async () => {
    const { container } = render(<Composer activeAgent={fixtureAgent()} onSubmit={vi.fn()} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const files = Array.from(
      { length: 17 },
      (_, i) => new File([new Uint8Array([i])], `img-${i}.png`, { type: "image/png" }),
    );
    fireEvent.change(input, { target: { files } });
    await waitFor(() => {
      expect(container.querySelectorAll(".composer-chip").length).toBe(16);
    });
    const toasts = useUiStore.getState().toasts;
    expect(toasts.some((t) => t.severity === "warn" && /16 images/.test(t.message))).toBe(true);
  });

  it("R17-W6: image-only submit synthesizes a prompt and forwards the image", async () => {
    const onSubmit = vi.fn().mockResolvedValue("run-x");
    const { container } = render(<Composer activeAgent={fixtureAgent()} onSubmit={onSubmit} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // bytes [1,2,3] → base64 "AQID"
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(container.querySelectorAll(".composer-chip").length).toBe(1);
    });
    // Empty draft + one image: submit must synthesize a non-empty prompt
    // (POST /api/runs requires prompt length ≥ 1) and forward the image.
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({
      prompt: "(see attached image)",
      agentId: "agent-1",
      images: [{ data: "AQID", mimeType: "image/png" }],
    });
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
