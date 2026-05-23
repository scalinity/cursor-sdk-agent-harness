import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { HttpError, httpRequest, mutatingRequest } from "../http-client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("http-client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("attaches X-CSRF-Token + X-Request-Id on mutating verbs", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await httpRequest("/api/test", { method: "POST", body: { v: 1 }, csrfToken: "T" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-CSRF-Token"]).toBe("T");
    expect(headers["X-Request-Id"]).toMatch(/.+/);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.method).toBe("POST");
  });

  it("throws CSRF_TOKEN_MISSING synchronously when mutating without token", async () => {
    await expect(httpRequest("/api/x", { method: "PUT" })).rejects.toMatchObject({
      code: "CSRF_TOKEN_MISSING",
      status: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not attach CSRF on GET", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await httpRequest("/api/x");
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-CSRF-Token"]).toBeUndefined();
    expect(headers["X-Request-Id"]).toMatch(/.+/);
  });

  it("validates response schema and throws SCHEMA_VALIDATION_FAILED on mismatch", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { wrong: true }));
    const schema = z.object({ ok: z.boolean() });
    await expect(httpRequest("/api/x", { responseSchema: schema })).rejects.toMatchObject({
      code: "SCHEMA_VALIDATION_FAILED",
    });
  });

  it("preserves error code envelope on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { code: "CSRF_FAILED", message: "expired" }));
    try {
      await httpRequest("/api/x", { method: "POST", body: {}, csrfToken: "T" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).code).toBe("CSRF_FAILED");
      expect((e as HttpError).status).toBe(403);
      expect((e as HttpError).requestId).toMatch(/.+/);
    }
  });

  it("mutatingRequest retries once on CSRF_FAILED after refresh succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { code: "CSRF_FAILED" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    let tokenValue: string | null = "stale";
    const refreshCsrfToken = vi.fn(async () => {
      tokenValue = "fresh";
      return tokenValue;
    });
    const result = await mutatingRequest("/api/x", {
      method: "POST",
      body: {},
      getCsrfToken: () => tokenValue,
      refreshCsrfToken,
    });
    expect(result).toEqual({ ok: true });
    expect(refreshCsrfToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondInit = fetchMock.mock.calls[1]![1] as RequestInit;
    const secondHeaders = secondInit.headers as Record<string, string>;
    expect(secondHeaders["X-CSRF-Token"]).toBe("fresh");
  });

  it("mutatingRequest surfaces the original error if refresh returns null", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { code: "CSRF_FAILED" }));
    const refreshCsrfToken = vi.fn(async () => null);
    await expect(
      mutatingRequest("/api/x", {
        method: "POST",
        body: {},
        getCsrfToken: () => "stale",
        refreshCsrfToken,
      }),
    ).rejects.toMatchObject({ code: "CSRF_FAILED" });
    expect(refreshCsrfToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("mutatingRequest does NOT retry non-CSRF errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { code: "INTERNAL_ERROR" }));
    const refreshCsrfToken = vi.fn(async () => "fresh");
    await expect(
      mutatingRequest("/api/x", {
        method: "POST",
        body: {},
        getCsrfToken: () => "T",
        refreshCsrfToken,
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(refreshCsrfToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
