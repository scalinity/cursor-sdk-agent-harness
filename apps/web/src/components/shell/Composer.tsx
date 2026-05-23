import { useCallback, useRef, useState } from "react";
import type { AgentSummary } from "@harness/shared";
import { useUiStore } from "../../state/ui-store.js";
import { useErrorReporter } from "../../hooks/useErrorReporter.js";

export interface ComposerProps {
  activeAgent: AgentSummary | null;
  onSubmit: (input: { prompt: string; agentId: string }) => Promise<string>;
}

/**
 * Composer — input textarea + model picker placeholder + Send button.
 * Submits via the agent-stream hook; on submit the parent's `onSubmit`
 * is responsible for setting the active run id (it returns the runId).
 */
export function Composer({ activeAgent, onSubmit }: ComposerProps) {
  const draft = useUiStore((s) => s.composerDraft);
  const setDraft = useUiStore((s) => s.setComposerDraft);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const { report } = useErrorReporter("composer");

  const submit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || !activeAgent || busy) return;
    setBusy(true);
    try {
      await onSubmit({ prompt: trimmed, agentId: activeAgent.id });
      setDraft("");
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }, [draft, activeAgent, busy, onSubmit, setDraft, report]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const placeholder = activeAgent
    ? `Send a prompt to ${activeAgent.name}…`
    : "Create or select an agent to start.";

  return (
    <div className="composer">
      <div className="composer-box">
        <div className="mb-1.5 flex items-center gap-2 text-sm text-text-tertiary">
          <span className="inline-flex h-5 items-center gap-1.5 rounded-sm border border-border-subtle bg-surface-2 px-2 text-xs text-text-secondary">
            {activeAgent ? activeAgent.modelId : "no model"}
          </span>
        </div>
        <textarea
          ref={inputRef}
          className="composer-textarea"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!activeAgent || busy}
        />
        <div className="mt-2 flex items-center gap-1.5 text-xs text-text-tertiary">
          <button
            type="button"
            className="inline-flex h-control-md items-center gap-1.5 rounded-md border border-border-subtle bg-surface-2 px-2 text-md font-medium text-text-primary"
            disabled
            title="Model picker (Phase 12)"
          >
            <span className="size-2 rounded-full bg-accent-primary" aria-hidden="true" />
            <span>{activeAgent?.modelId ?? "model"}</span>
          </button>
          <button
            type="button"
            className="inline-flex h-control-md items-center gap-1.5 rounded-md border border-transparent bg-accent-bg px-2.5 text-md font-medium text-accent-primary"
            disabled
            title="Extended thinking (Phase 12)"
          >
            Extended thinking
          </button>
          <div className="ml-auto">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!activeAgent || busy || draft.trim().length === 0}
              className="inline-flex h-control-sm items-center gap-1.5 rounded-sm border-0 bg-accent-primary px-2.5 text-sm font-semibold text-text-inverse disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
