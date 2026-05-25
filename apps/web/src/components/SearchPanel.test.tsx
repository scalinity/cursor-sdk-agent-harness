import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("renders Text, Files, and Semantic toggles", () => {
    render(<SearchPanel />);
    expect(screen.getByRole("button", { name: "Text" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Files" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Semantic" })).not.toBeNull();
  });

  it("runs a semantic search and shows results with relevance scores", async () => {
    render(<SearchPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Semantic" }));
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
});
