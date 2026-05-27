import { useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { generateCommandResponseSchema } from "@harness/shared";
import { useTerminalSession } from "../../hooks/useTerminalSession.js";
import { useCsrfToken } from "../../hooks/useCsrfToken.js";
import { mutatingRequest } from "../../lib/http-client.js";
import { useUiStore } from "../../state/ui-store.js";
import { SparkIcon } from "./ToolbarIcons.js";

interface GeneratedTerminalCommand {
  command: string;
  explanation: string;
  dangerous: boolean;
}

/**
 * Right-pane embedded terminal. A thin host for xterm — all imperative wiring
 * lives in `useTerminalSession` (no effects in this component). The shell runs
 * on the server (PTY over `/ws/terminal`) in the active workspace directory.
 */
export function TerminalSurface() {
  const { hostRef, status, insertText, runText } = useTerminalSession();
  const activeWorkspace = useUiStore((s) => s.activeWorkspace);
  const csrf = useCsrfToken();
  const [isHelperOpen, setIsHelperOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [generated, setGenerated] = useState<GeneratedTerminalCommand | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openHelper = (): void => {
    setIsHelperOpen(true);
    setError(null);
  };

  const generateCommand = async (): Promise<void> => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setIsGenerating(true);
    setError(null);
    try {
      const result = await mutatingRequest("/api/terminal/generate-command", {
        method: "POST",
        body: {
          prompt: trimmed,
          shell: "zsh",
          cwd: activeWorkspace?.path ?? ".",
        },
        responseSchema: generateCommandResponseSchema,
        getCsrfToken: () => useUiStore.getState().csrfToken,
        refreshCsrfToken: csrf.refresh,
      });
      setGenerated(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate command");
    } finally {
      setIsGenerating(false);
    }
  };

  const copyGeneratedCommand = async (): Promise<void> => {
    if (!generated || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(generated.command);
  };

  return (
    <div
      className="terminal-surface"
      data-testid="terminal-surface"
      tabIndex={-1}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          openHelper();
        }
      }}
    >
      <div ref={hostRef} className="terminal-surface__host" />
      <button
        type="button"
        className="terminal-surface__ai-trigger"
        aria-label="AI command"
        title="AI command"
        onClick={openHelper}
      >
        <SparkIcon className="size-3" />
        <span>AI command</span>
      </button>
      {isHelperOpen ? (
        <div className="terminal-surface__ai-panel" role="dialog" aria-label="AI command helper">
          <form
            className="terminal-surface__ai-form"
            onSubmit={(event) => {
              event.preventDefault();
              void generateCommand();
            }}
          >
            <input
              className="terminal-surface__ai-input"
              aria-label="AI command prompt"
              value={prompt}
              placeholder="show disk usage"
              onChange={(event) => {
                setPrompt(event.target.value);
                setGenerated(null);
                setError(null);
              }}
            />
            <button
              type="submit"
              className="terminal-surface__ai-button terminal-surface__ai-button--primary"
              aria-label="Generate command"
              disabled={isGenerating || !prompt.trim()}
            >
              {isGenerating ? "Generating" : "Generate"}
            </button>
            <button
              type="button"
              className="terminal-surface__ai-button"
              aria-label="Close AI command helper"
              onClick={() => setIsHelperOpen(false)}
            >
              Close
            </button>
          </form>
          {error ? <div className="terminal-surface__ai-error">{error}</div> : null}
          {generated ? (
            <div className="terminal-surface__ai-result">
              <div className="terminal-surface__ai-command mono">{generated.command}</div>
              <div className="terminal-surface__ai-explanation">{generated.explanation}</div>
              {generated.dangerous ? (
                <div className="terminal-surface__ai-warning">Review before running</div>
              ) : null}
              <div className="terminal-surface__ai-actions">
                <button
                  type="button"
                  className="terminal-surface__ai-button"
                  aria-label="Insert command"
                  onClick={() => insertText(generated.command)}
                >
                  Insert
                </button>
                <button
                  type="button"
                  className="terminal-surface__ai-button"
                  aria-label="Copy command"
                  onClick={() => void copyGeneratedCommand()}
                >
                  Copy
                </button>
                <button
                  type="button"
                  className="terminal-surface__ai-button terminal-surface__ai-button--primary"
                  aria-label="Run command"
                  disabled={generated.dangerous}
                  onClick={() => runText(generated.command)}
                >
                  Run
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {status === "disconnected" ? (
        <div className="terminal-surface__status">reconnecting…</div>
      ) : null}
    </div>
  );
}
