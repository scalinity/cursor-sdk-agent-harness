import { useCallback, useState } from "react";
import {
  DEFAULT_MODEL_ID,
  MODEL_LABELS,
  modelIdSchema,
  type AgentSummary,
} from "@harness/shared";
import { useUiStore } from "../../state/ui-store.js";
import { useErrorReporter } from "../../hooks/useErrorReporter.js";

/**
 * Render-rule for the model pill. Exported for `Composer.test.tsx`. See the
 * inline comment at the call site for the three branches; the unknown-id
 * branch is the load-bearing one — the pill must surface the agent's real
 * model id even when the harness MODEL_LABELS map lacks an entry, so that
 * "looks wrong" prompts a MODEL_LABELS update instead of silent misreporting.
 */
export function describeModel(
  activeAgent: AgentSummary | null,
): { modelLabel: string; modelTitle: string } {
  if (!activeAgent) {
    const label = MODEL_LABELS[DEFAULT_MODEL_ID];
    return {
      modelLabel: label,
      modelTitle: `Default model: ${label}. Models are configured per agent in the New Agent dialog.`,
    };
  }
  const parsed = modelIdSchema.safeParse(activeAgent.modelId);
  if (parsed.success) {
    const label = MODEL_LABELS[parsed.data];
    return {
      modelLabel: label,
      modelTitle: `Model: ${label} (set on agent ${activeAgent.name})`,
    };
  }
  return {
    modelLabel: `${activeAgent.modelId} (unknown)`,
    modelTitle: `Unknown model id "${activeAgent.modelId}" set on agent ${activeAgent.name}. Update the harness MODEL_LABELS map to render a friendly name.`,
  };
}

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
  const [focused, setFocused] = useState(false);
  const { report } = useErrorReporter("composer");

  const submit = useCallback(async () => {
    // Read the latest draft from the store at submit time rather than the
    // captured closure value — protects against programmatic updates
    // (Phase 12 templates / /commands) racing the captured snapshot.
    const trimmed = useUiStore.getState().composerDraft.trim();
    if (!trimmed || busy) return;
    if (!activeAgent) {
      // Textarea is enabled without an agent so users can draft, but Send
      // still needs an agent. The Send button surfaces this with a tooltip;
      // keyboard users hitting Enter would otherwise get no feedback, so
      // toast the same hint so the action isn't silent.
      report("Create or select an agent to send.", { severity: "info" });
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ prompt: trimmed, agentId: activeAgent.id });
      setDraft("");
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }, [activeAgent, busy, onSubmit, setDraft, report]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Guard against IME composition: during CJK/Korean candidate selection
    // browsers dispatch a keydown with key="Enter" AND isComposing=true to
    // commit the candidate; submitting here would burn API budget on the
    // half-finished prompt. keyCode 229 is the legacy fallback some older
    // mobile WebViews still emit during composition; TS flags it as
    // deprecated but the property is what these clients actually surface.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const placeholder = activeAgent
    ? `Send a prompt to ${activeAgent.name}…`
    : "Type a prompt — create or select an agent to send.";

  // The model that *will* be used. Three cases, kept explicit because
  // collapsing them through a single safeParse fallback silently mislabels
  // an agent that's running on a model the harness enum hasn't been
  // updated for:
  //   - no agent           → DEFAULT_MODEL_ID's label ("Composer 2.5 Fast")
  //   - agent, known model → MODEL_LABELS[modelId]
  //   - agent, unknown id  → raw id + "(unknown)". Never fabricate a
  //     different model's name — the user must see what their agent is
  //     actually running, so that "looks wrong" leads to a MODEL_LABELS
  //     update rather than silent misreporting.
  const { modelLabel, modelTitle } = describeModel(activeAgent);

  // Reasoning effort knob intentionally absent. The Cursor SDK exposes
  // per-model parameters via `Cursor.models.list()[…].parameters` and the
  // run-time `model.params` field, but the harness has not yet wired model
  // discovery, so we can't tell whether the active model supports a
  // reasoning_effort parameter. Per the spec's "honest about the SDK" rule
  // we render no control rather than a fake / always-disabled one. Re-add
  // this once a `useSdkModels()` hook surfaces the model's parameters.

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          className="composer-textarea"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        {focused && draft.length === 0 ? <span className="composer-caret" aria-hidden="true" /> : null}
        <div className="mt-2 flex items-center gap-1.5 text-xs text-text-tertiary">
          <span
            className="inline-flex h-control-md items-center gap-1.5 rounded-md border border-border-subtle bg-surface-2 px-2 text-md font-medium text-text-primary"
            title={modelTitle}
            aria-label={modelTitle}
          >
            <span className="size-2 rounded-full bg-accent-primary" aria-hidden="true" />
            <span>{modelLabel}</span>
          </span>
          <div className="ml-auto">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!activeAgent || busy || draft.trim().length === 0}
              title={activeAgent ? undefined : "Create or select an agent to send"}
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
