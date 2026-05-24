import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserState } from "@harness/shared";
import { BrowserUrlBar } from "./BrowserUrlBar.js";

afterEach(cleanup);

function fixtureState(overrides: Partial<BrowserState> = {}): BrowserState {
  return {
    agentId: "agent-1",
    exists: true,
    url: "https://example.com/",
    title: "Example",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    lastAction: null,
    ...overrides,
  };
}

function handlers() {
  return {
    onNavigate: vi.fn(),
    onBack: vi.fn(),
    onForward: vi.fn(),
    onReload: vi.fn(),
    onStop: vi.fn(),
  };
}

describe("BrowserUrlBar", () => {
  it("shows the current url in the address field", () => {
    render(<BrowserUrlBar state={fixtureState()} {...handlers()} />);
    expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe(
      "https://example.com/",
    );
  });

  it("navigates to the typed value on submit", () => {
    const h = handlers();
    render(<BrowserUrlBar state={fixtureState()} {...h} />);
    const input = screen.getByLabelText("Address");
    fireEvent.change(input, { target: { value: "  example.org  " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(h.onNavigate).toHaveBeenCalledWith("example.org");
  });

  it("disables back/forward per history state", () => {
    const h = handlers();
    render(
      <BrowserUrlBar state={fixtureState({ canGoBack: true, canGoForward: false })} {...h} />,
    );
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole("button", { name: "Forward" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(h.onBack).toHaveBeenCalledTimes(1);
  });

  it("toggles reload vs stop on loading and routes the click", () => {
    const idle = handlers();
    const { rerender } = render(<BrowserUrlBar state={fixtureState()} {...idle} />);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(idle.onReload).toHaveBeenCalledTimes(1);

    const busy = handlers();
    rerender(<BrowserUrlBar state={fixtureState({ loading: true })} {...busy} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(busy.onStop).toHaveBeenCalledTimes(1);
  });
});
