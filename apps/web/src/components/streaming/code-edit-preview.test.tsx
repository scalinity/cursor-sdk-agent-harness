import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerFrame } from "@harness/shared";
import { useRunStore } from "../../state/run-store.js";
import { useUiStore } from "../../state/ui-store.js";
import { buildAnimationChunks, type CodeEditPayload } from "../../lib/code-edit-events.js";
import { SyntaxHighlighter } from "./SyntaxHighlighter.js";
import { CodeEditPreview } from "./CodeEditPreview.js";
import { CodeEditPreviewPanel } from "./CodeEditPreviewPanel.js";

function resetRunStore() {
  useRunStore.setState({ byId: {}, eventsByRunId: {}, activeRunId: null });
}

function resetUiStore() {
  useUiStore.setState({
    replaySpeedByRunId: {},
    replayPausedByRunId: {},
    selectedCodeEditEventByRunId: {},
    codeHidden: false,
  });
}

function codeEditFrame(payload?: CodeEditPayload): ServerFrame {
  return {
    id: "frame-code-edit",
    type: "derived.code_edit",
    sent_at: "2026-05-23T12:00:00.000Z",
    event: {
      event_id: "evt-code-edit",
      schema_version: 1,
      seq: 1,
      agent_id: "agent-1",
      run_id: "run-1",
      occurred_at: "2026-05-23T12:00:00.000Z",
      received_at: "2026-05-23T12:00:00.000Z",
      sdk_type: "tool_call",
      kind: "code_edit.detected",
      payload: payload ?? {
        source_call_id: "call-1",
        confidence: "high",
        edits: [
          {
            path: "src/demo.ts",
            language: "typescript",
            before: "const answer = 41;\n",
            after: "const answer = 42;\n",
            operations: [{ type: "replace", startOffset: 15, endOffset: 17, text: "42" }],
          },
        ],
      },
    },
  };
}

describe("code edit preview surfaces", () => {
  afterEach(() => {
    cleanup();
    resetRunStore();
    resetUiStore();
  });

  it("renders TypeScript token classes from Lezer", async () => {
    render(<SyntaxHighlighter language="typescript" text="const answer: number = 42;" />);

    await waitFor(() => {
      expect(document.querySelector(".tk-key")?.textContent).toBe("const");
      expect(document.querySelector(".tk-num")?.textContent).toBe("42");
    });
  });

  it("renders a derived code edit event in the preview panel", async () => {
    useRunStore.getState().ingestServerFrame(codeEditFrame());
    useUiStore.getState().setReplaySpeed("run-1", "instant");

    render(<CodeEditPreviewPanel runId="run-1" />);

    expect(screen.getAllByText("src/demo.ts").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /instant/i })).not.toBeNull();

    await waitFor(() => {
      const editor = screen.getByTestId("code-edit-editor-src/demo.ts");
      expect(within(editor).getByText(/const answer = 42;/)).not.toBeNull();
    });
  });

  it("defaults replay controls to animated 1x", () => {
    useRunStore.getState().ingestServerFrame(codeEditFrame());

    render(<CodeEditPreviewPanel runId="run-1" />);

    expect(screen.getByRole("button", { name: "1x" }).className).toContain("is-active");
  });

  it("derives operation chunks with seeded buffers and deletion text", () => {
    const chunks = buildAnimationChunks({
      source_call_id: "call-1",
      confidence: "high",
      edits: [
        {
          path: "src/demo.ts",
          language: "typescript",
          before: "const answer = 41;\n",
          operations: [{ type: "replace", startOffset: 15, endOffset: 17, text: "42" }],
        },
      ],
    });

    expect(chunks).toEqual([
      {
        path: "src/demo.ts",
        startOffset: 15,
        initialText: "const answer = 41;\n",
        deleteText: "41",
        insertText: "42",
      },
    ]);
  });

  it("bounds large edit previews to the first chunk by default", async () => {
    const largeText = "a".repeat(50_000);
    useRunStore.getState().ingestServerFrame(
      codeEditFrame({
        source_call_id: "call-1",
        confidence: "medium",
        edits: [
          {
            path: "src/large.ts",
            language: "typescript",
            after: largeText,
            operations: [{ type: "insert", startOffset: 0, endOffset: 0, text: largeText }],
          },
        ],
      }),
    );

    render(<CodeEditPreview runId="run-1" eventId="evt-code-edit" />);

    expect(screen.getByText(/50,000 chars; showing first 2,000/)).not.toBeNull();
    await waitFor(() => {
      const editor = screen.getByTestId("code-edit-editor-src/large.ts");
      expect(editor.textContent?.includes("a".repeat(2_000))).toBe(true);
      expect(editor.textContent?.includes("a".repeat(2_001))).toBe(false);
    });
  });
});
