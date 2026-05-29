import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalSurface } from "./TerminalSurface.js";

const h = vi.hoisted(() => ({
  status: "connected" as "connected" | "disconnected",
}));

vi.mock("../../hooks/useTerminalSession.js", () => ({
  useTerminalSession: () => ({
    hostRef: { current: null },
    status: h.status,
  }),
}));

describe("TerminalSurface", () => {
  beforeEach(() => {
    h.status = "connected";
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the embedded terminal surface without the AI command helper", () => {
    render(<TerminalSurface />);

    expect(screen.getByTestId("terminal-surface")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /AI Command/i })).toBeNull();
    expect(screen.queryByRole("dialog", { name: /AI command helper/i })).toBeNull();
    expect(screen.queryByPlaceholderText("show disk usage")).toBeNull();
  });

  it("keeps Cmd+K from opening the removed command generator", () => {
    render(<TerminalSurface />);

    fireEvent.keyDown(screen.getByTestId("terminal-surface"), { key: "k", metaKey: true });

    expect(screen.queryByPlaceholderText("show disk usage")).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      "/api/terminal/generate-command",
      expect.any(Object),
    );
  });

  it("shows reconnecting status while disconnected", () => {
    h.status = "disconnected";

    render(<TerminalSurface />);

    expect(screen.getByText("reconnecting…")).toBeTruthy();
  });
});
