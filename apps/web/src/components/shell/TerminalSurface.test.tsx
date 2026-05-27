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

  it("renders the embedded terminal surface with the AI command helper closed", () => {
    render(<TerminalSurface />);

    expect(screen.getByTestId("terminal-surface")).toBeTruthy();
    expect(screen.getByRole("button", { name: /AI Command/i })).toBeTruthy();
    expect(screen.queryByPlaceholderText("show disk usage")).toBeNull();
  });

  it("opens the command generator on Cmd+K without calling the route before submit", () => {
    render(<TerminalSurface />);

    fireEvent.keyDown(screen.getByTestId("terminal-surface"), { key: "k", metaKey: true });

    expect(screen.getByPlaceholderText("show disk usage")).toBeTruthy();
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
