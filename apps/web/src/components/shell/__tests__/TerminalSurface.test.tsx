import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalSurface } from "../TerminalSurface.js";
import { useUiStore } from "../../../state/ui-store.js";

const terminalSessionMock = vi.hoisted(() => ({
  insertText: vi.fn(),
  runText: vi.fn(),
}));

vi.mock("../../../hooks/useTerminalSession.js", () => ({
  useTerminalSession: () => ({
    hostRef: { current: null },
    status: "connected",
    insertText: terminalSessionMock.insertText,
    runText: terminalSessionMock.runText,
  }),
}));

vi.mock("../../../hooks/useCsrfToken.js", () => ({
  useCsrfToken: () => ({
    token: "csrf-token",
    loading: false,
    error: null,
    refresh: vi.fn(async () => "csrf-token"),
  }),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("TerminalSurface AI command affordance", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    terminalSessionMock.insertText.mockReset();
    terminalSessionMock.runText.mockReset();
    useUiStore.setState({
      csrfToken: "csrf-token",
      activeWorkspace: {
        id: "workspace-1",
        path: "/tmp/project",
        label: "Project",
        recursive: true,
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z",
        lastUsedAt: null,
      },
      activeWorkspaceId: "workspace-1",
    });
  });

  it("generates a command from natural language and lets the user insert or run it explicitly", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        command: "du -sh * | sort -rh | head -20",
        explanation: "Show disk usage of current directory contents, sorted by size",
        dangerous: false,
      }),
    );

    render(<TerminalSurface />);

    fireEvent.click(screen.getByRole("button", { name: /ai command/i }));
    fireEvent.change(screen.getByLabelText(/ai command prompt/i), {
      target: { value: "show disk usage" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate command/i }));

    await screen.findByText("du -sh * | sort -rh | head -20");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-token");
    expect(JSON.parse(String(init.body))).toMatchObject({
      prompt: "show disk usage",
      shell: "zsh",
      cwd: "/tmp/project",
    });

    fireEvent.click(screen.getByRole("button", { name: /insert command/i }));
    expect(terminalSessionMock.insertText).toHaveBeenCalledWith("du -sh * | sort -rh | head -20");
    expect(terminalSessionMock.runText).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /run command/i }));
    expect(terminalSessionMock.runText).toHaveBeenCalledWith("du -sh * | sort -rh | head -20");
  });

  it("keeps dangerous generated commands preview-only instead of exposing one-click run", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        command: "rm -rf node_modules",
        explanation: "Remove a directory tree",
        dangerous: true,
      }),
    );

    render(<TerminalSurface />);

    fireEvent.keyDown(screen.getByTestId("terminal-surface"), { key: "k", metaKey: true });
    fireEvent.change(screen.getByLabelText(/ai command prompt/i), {
      target: { value: "delete node_modules" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate command/i }));

    await screen.findByText("rm -rf node_modules");
    expect(screen.getByText(/review before running/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /run command/i })).toHaveProperty("disabled", true);
  });
});
