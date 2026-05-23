/**
 * useMcpServers smoke — verifies the hook lists redacted configs and
 * POSTs the raw config on create with the CSRF token header. We do not
 * exercise the validation probe here; that is covered by the server-side
 * mcp-validator tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUiStore } from "../../state/ui-store.js";
import { useMcpServers } from "../useMcpServers.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useMcpServers", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    useUiStore.setState({ csrfToken: "csrf-test" });
  });

  it("hydrates the list with the redacted configs from /api/mcp-servers", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        items: [
          {
            id: "m-1",
            name: "github",
            enabled: true,
            validationStatus: "valid",
            validationMessage: null,
            lastStatus: "ok",
            lastCheckedAt: "2026-05-23T13:00:00.000Z",
            createdAt: "2026-05-23T12:00:00.000Z",
            updatedAt: "2026-05-23T13:00:00.000Z",
            configRedacted: { command: "/usr/bin/node", env: { TOKEN: "[REDACTED]" } },
            transport: "stdio",
          },
        ],
      }),
    );
    const { result } = renderHook(() => useMcpServers());
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.servers).toHaveLength(1);
    const first = result.current.servers[0]!;
    expect(first.name).toBe("github");
    if ("env" in first.configRedacted) {
      expect(first.configRedacted.env?.TOKEN).toBe("[REDACTED]");
    }
  });

  it("POSTs the raw config on create and updates the local list", async () => {
    fetchMock
      .mockResolvedValue(
        jsonResponse(201, {
          id: "m-new",
          name: "fs",
          enabled: true,
          validationStatus: "valid",
          validationMessage: "ok",
          lastStatus: "ok",
          lastCheckedAt: "2026-05-23T13:00:00.000Z",
          createdAt: "2026-05-23T13:00:00.000Z",
          updatedAt: "2026-05-23T13:00:00.000Z",
          configRedacted: { command: "/usr/bin/echo" },
          transport: "stdio",
        }),
      );
    // The first response on mount goes to the initial reload — that's a
    // GET against /api/mcp-servers and we want it to be a valid list, so
    // override the default just for that call.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    const { result } = renderHook(() => useMcpServers());
    // Settle the mount-effect reload before invoking create.
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.create({
        name: "fs",
        enabled: true,
        config: { command: "/usr/bin/echo" },
      });
    });

    const postCall = fetchMock.mock.calls.find(
      (call) => (call[1] as { method?: string } | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const postInit = postCall?.[1] as
      | { headers?: Record<string, string>; body?: string }
      | undefined;
    expect(postInit?.headers?.["X-CSRF-Token"]).toBe("csrf-test");
    expect(JSON.parse(String(postInit?.body))).toEqual({
      name: "fs",
      enabled: true,
      config: { command: "/usr/bin/echo" },
    });
    expect(result.current.servers.some((s) => s.id === "m-new")).toBe(true);
  });
});
