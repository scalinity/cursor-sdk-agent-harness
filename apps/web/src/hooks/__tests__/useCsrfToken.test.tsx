import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCsrfToken } from "../useCsrfToken.js";
import { useUiStore } from "../../state/ui-store.js";

// Regression coverage for F-002. Eight independent hook consumers
// (AppShell + 7 data hooks) + StrictMode's double-mount → 16 mount
// effects. Before the fix each instance held its own in-flight ref, so
// the dedupe was per-instance and all 16 fired `/api/security/csrf-token`
// concurrently. After the fix the in-flight promise is module-scoped and
// only one network request happens regardless of N consumers.

const FETCH_BODY = JSON.stringify({ token: "test-token-123" });

beforeEach(() => {
  // Reset module-level state by clearing the stored token.
  useUiStore.setState({ csrfToken: null });
  vi.restoreAllMocks();
});

describe("useCsrfToken — F-002", () => {
  it("only fetches the CSRF token once when N hook instances mount concurrently", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(FETCH_BODY, { status: 200 }));

    // 8 concurrent renderHooks simulates the real call sites
    // (AppShell + 7 data hooks). Each one independently subscribes to
    // useCsrfToken and triggers its mount-effect fetch path.
    const hooks = Array.from({ length: 8 }, () => renderHook(() => useCsrfToken()));

    await waitFor(() => {
      for (const h of hooks) expect(h.result.current.token).toBe("test-token-123");
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    for (const h of hooks) h.unmount();
  });

  it("refresh() during an in-flight fetch returns the same promise", async () => {
    let resolveFetch: (value: Response) => void = () => undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const a = renderHook(() => useCsrfToken());
    const b = renderHook(() => useCsrfToken());
    // Both refresh() calls during the in-flight cold fetch must coalesce.
    const aRefresh = a.result.current.refresh();
    const bRefresh = b.result.current.refresh();
    resolveFetch(new Response(FETCH_BODY, { status: 200 }));
    await act(async () => {
      const [aTok, bTok] = await Promise.all([aRefresh, bRefresh]);
      expect(aTok).toBe("test-token-123");
      expect(bTok).toBe("test-token-123");
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    a.unmount();
    b.unmount();
  });
});
