import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalSurface } from "../TerminalSurface.js";

const terminalSessionMock = vi.hoisted(() => ({
  status: "connected",
}));

vi.mock("../../../hooks/useTerminalSession.js", () => ({
  useTerminalSession: () => ({
    hostRef: { current: null },
    status: terminalSessionMock.status,
  }),
}));

describe("TerminalSurface", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    terminalSessionMock.status = "connected";
  });

  it("renders a plain xterm host without the AI command affordance", () => {
    render(<TerminalSurface />);

    expect(screen.getByTestId("terminal-surface")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ai command/i })).toBeNull();
    expect(screen.queryByRole("dialog", { name: /ai command helper/i })).toBeNull();
    expect(screen.queryByLabelText(/ai command prompt/i)).toBeNull();
  });

  it("shows a reconnecting status when the terminal disconnects", () => {
    terminalSessionMock.status = "disconnected";

    render(<TerminalSurface />);

    expect(screen.getByText("reconnecting…")).toBeTruthy();
  });
});
