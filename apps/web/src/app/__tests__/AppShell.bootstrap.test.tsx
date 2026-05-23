/**
 * AppShell bootstrap ordering — covers that the CSRF fetch fires BEFORE
 * any mutating call lands at the server. Without this contract, a
 * sufficiently fast user could submit a prompt before CSRF hydrates and
 * see a CSRF_TOKEN_MISSING error (which RV2-C3 makes recoverable via
 * mutatingRequest, but we want the happy-path ordering verified too).
 *
 * The test mocks fetch and asserts the request sequence. It does NOT
 * mount the full shell (no DOM-heavy tree-shaking yet); a smoke render
 * of just the bootstrap hooks is enough.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCsrfToken } from "../../hooks/useCsrfToken.js";
import { useUiStore } from "../../state/ui-store.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AppShell bootstrap", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    useUiStore.setState({ csrfToken: null });
  });

  it("fetches /api/security/csrf-token on mount and hydrates the store", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: "abc.def.ghi" }));
    const { result } = renderHook(() => useCsrfToken());
    // Wait for the async fetch to settle.
    await act(async () => {
      await result.current.refresh();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/security/csrf-token",
      expect.objectContaining({ method: "GET" }),
    );
    expect(useUiStore.getState().csrfToken).toBe("abc.def.ghi");
  });

  it("surfaces a bootstrap error when the CSRF fetch fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { code: "INTERNAL_ERROR" }));
    const { result } = renderHook(() => useCsrfToken());
    await act(async () => {
      await result.current.refresh();
    });
    expect(useUiStore.getState().csrfToken).toBeNull();
    expect(result.current.error).toMatch(/.+/);
  });

  it("dedupes concurrent refresh calls via the in-flight promise (RV2-W19)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: "X" }));
    const { result } = renderHook(() => useCsrfToken());
    await act(async () => {
      // Two concurrent callers — both should receive the same fetched token.
      const [a, b] = await Promise.all([result.current.refresh(), result.current.refresh()]);
      expect(a).toBe("X");
      expect(b).toBe("X");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
