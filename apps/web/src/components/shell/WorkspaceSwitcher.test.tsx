import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceAllowlistRow } from "@harness/shared";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher.js";

const h = vi.hoisted(() => ({
  setActive: vi.fn(),
  pick: vi.fn(async () => ({ ok: true as const })),
  reload: vi.fn(),
}));

const homeRow: WorkspaceAllowlistRow = {
  id: "ws-home",
  path: "/Users/danny",
  label: "Home",
  recursive: true,
  createdAt: "2026-05-24T10:00:00.000Z",
  updatedAt: "2026-05-24T10:00:00.000Z",
  lastUsedAt: null,
};
const alphaRow: WorkspaceAllowlistRow = {
  id: "ws-1",
  path: "/projects/alpha",
  label: null,
  recursive: true,
  createdAt: "2026-05-24T10:00:00.000Z",
  updatedAt: "2026-05-24T10:00:00.000Z",
  lastUsedAt: null,
};

vi.mock("../../hooks/useWorkspaceAllowlist.js", () => ({
  useWorkspaceAllowlist: () => ({
    entries: [homeRow, alphaRow],
    loading: false,
    error: null,
    reload: h.reload,
    add: vi.fn(),
    validateMany: vi.fn(),
  }),
}));
vi.mock("../../hooks/useActiveWorkspace.js", () => ({
  useActiveWorkspace: () => ({
    workspace: homeRow,
    activeWorkspaceId: "ws-home",
    loading: false,
    error: null,
    reload: vi.fn(),
    setActive: h.setActive,
  }),
}));
vi.mock("../../hooks/useWorkspacePicker.js", () => ({
  useWorkspacePicker: () => ({ pick: h.pick, busy: false }),
}));

describe("WorkspaceSwitcher", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the active workspace name and a Local run-target badge", () => {
    render(<WorkspaceSwitcher />);
    expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
    expect(screen.getByText("Local")).toBeTruthy();
  });

  it("opens the menu and lists recents (other workspaces by path)", () => {
    render(<WorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(screen.getByText("Recents")).toBeTruthy();
    expect(screen.getByText("/projects/alpha")).toBeTruthy();
  });

  it("activates a workspace when its menu item is clicked", () => {
    render(<WorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(screen.getByText("/projects/alpha"));
    expect(h.setActive).toHaveBeenCalledWith("ws-1");
  });

  it("opens the native folder picker from the footer action", () => {
    render(<WorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(screen.getByText("Open Folder…"));
    expect(h.pick).toHaveBeenCalledTimes(1);
  });
});
