import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceAllowlistRow } from "@harness/shared";

// Both reload (GET /api/workspace-allowlist → { items }) and the csrf
// bootstrap (GET /api/security/csrf-token → { token }) flow through
// httpRequest; a combined object satisfies both since the mock ignores the
// per-call responseSchema. add()/remove() go through mutatingRequest.
vi.mock("../../lib/http-client.js", () => ({
  httpRequest: vi.fn(),
  mutatingRequest: vi.fn(),
}));

import { httpRequest, mutatingRequest } from "../../lib/http-client.js";
import { useWorkspaceAllowlist } from "../useWorkspaceAllowlist.js";
import { __resetForTests as resetCsrf } from "../useCsrfToken.js";

function row(id: string, path: string): WorkspaceAllowlistRow {
  return {
    id,
    path,
    label: null,
    recursive: true,
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    lastUsedAt: null,
  };
}

describe("useWorkspaceAllowlist", () => {
  beforeEach(() => {
    resetCsrf();
    vi.mocked(httpRequest).mockResolvedValue({ items: [], token: "test-token" } as never);
    vi.mocked(mutatingRequest).mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("shares entries across hook instances so an added workspace is visible everywhere", async () => {
    // Two independent consumers — e.g. the sidebar (SessionsRail) and the
    // workspace picker — must observe the SAME allowlist. The picker adds a
    // workspace; the rail must show it without a reload.
    const railView = renderHook(() => useWorkspaceAllowlist());
    const pickerView = renderHook(() => useWorkspaceAllowlist());

    // Let the mount-time reload (and the csrf bootstrap it triggers) settle so
    // it can't overwrite the optimistic add below.
    await waitFor(() => expect(httpRequest).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    vi.mocked(mutatingRequest).mockResolvedValue(row("ws-new", "/p/new") as never);
    await act(async () => {
      await pickerView.result.current.add({ path: "/p/new", recursive: true });
    });

    expect(pickerView.result.current.entries.map((e) => e.id)).toContain("ws-new");
    // The bug: railView never saw the picker's add because each hook instance
    // held its own useState copy of `entries`.
    expect(railView.result.current.entries.map((e) => e.id)).toContain("ws-new");
  });
});
