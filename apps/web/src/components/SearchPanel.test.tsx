import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchPanel } from "./SearchPanel.js";

const SEMANTIC_RESPONSE = {
  results: [
    {
      path: "src/auth.ts",
      startLine: 1,
      endLine: 4,
      content: "export function authenticate(user) { return session; }",
      score: 0.85,
      language: "typescript",
    },
  ],
  indexStatus: { status: "indexed", totalChunks: 42, lastIndexedAt: "2026-05-25T10:00:00.000Z" },
};

describe("SearchPanel", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL) => {
      const u = url.toString();
      const body = u.includes("/api/search/semantic")
        ? SEMANTIC_RESPONSE
        : { results: [], totalMatches: 0, truncated: false, durationMs: 1 };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders compact icon-only search mode toggles with accessible labels", () => {
    render(<SearchPanel />);
    for (const label of ["Text", "Files", "Semantic"]) {
      const button = screen.getByRole("radio", { name: label });
      expect(button).not.toBeNull();
      expect(button.textContent).toBe("");
      expect(button.querySelector("svg")).not.toBeNull();
    }
  });

  it("runs a semantic search and shows results with relevance scores", async () => {
    render(<SearchPanel />);
    fireEvent.click(screen.getByRole("radio", { name: "Semantic" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "authenticate user" },
    });
    await waitFor(
      () => {
        expect(screen.getByText(/auth\.ts/)).not.toBeNull();
      },
      { timeout: 2000 },
    );
    // Score is rendered as a percentage.
    expect(screen.getByText(/85%/)).not.toBeNull();
  });

  it("ignores stale responses after switching search modes", async () => {
    vi.useFakeTimers();
    let resolveGrep: (() => void) | null = null;
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL) => {
      const u = url.toString();
      if (u.includes("/api/search/grep")) {
        return new Promise<Response>((resolve) => {
          resolveGrep = () =>
            resolve(
              new Response(
                JSON.stringify({
                  results: [
                    {
                      path: "src/stale.ts",
                      line: 1,
                      content: "stale grep result",
                      contextBefore: [],
                      contextAfter: [],
                    },
                  ],
                  totalMatches: 1,
                  truncated: false,
                  durationMs: 99,
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            );
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify(SEMANTIC_RESPONSE), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;

    try {
      render(<SearchPanel />);
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "authenticate" } });
      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });
      expect(resolveGrep).not.toBeNull();

      fireEvent.click(screen.getByRole("radio", { name: "Semantic" }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText(/auth\.ts/)).not.toBeNull();

      await act(async () => {
        resolveGrep?.();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.queryByText(/stale grep result/)).toBeNull();
      expect(screen.getByText(/auth\.ts/)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
