import { useCallback, useMemo, useRef, useState } from "react";
import {
  AUTO_MODEL_ID,
  MODEL_LABELS,
  PROVIDER_KIND_LABELS,
  type AgentSummary,
  type ContextMention,
  type ModelId,
  type SdkImage,
} from "@harness/shared";
import { useUiStore } from "../../state/ui-store.js";
import { useModels } from "../../hooks/useModels.js";
import { useErrorReporter } from "../../hooks/useErrorReporter.js";
import { useSpeechToText } from "../../hooks/useSpeechToText.js";
import { useMentionAutocomplete } from "../../hooks/useMentionAutocomplete.js";
import { cn } from "../../lib/cn.js";
import { Select, type SelectOption } from "../ui/Select.js";
import { MentionAutocomplete } from "../MentionAutocomplete.js";
import { ContextChipBar } from "../ContextChipBar.js";
import { ArrowUpIcon, MicIcon, PlusIcon, SparkIcon, XIcon } from "./ToolbarIcons.js";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher.js";
import {
  attachmentImages,
  fileReferenceText,
  fileToAttachment,
  MAX_IMAGE_ATTACHMENTS,
  type ComposerAttachment,
} from "../../lib/attachments.js";

export interface ComposerProps {
  activeAgent: AgentSummary | null;
  onSubmit: (input: { prompt: string; agentId: string; images?: SdkImage[]; mentions?: ContextMention[] }) => Promise<string>;
  /** Centered "new session" presentation when the chat is empty and the right pane is collapsed. */
  heroMode?: boolean;
}

/**
 * Composer — input textarea + attachments + model picker + Send button.
 * Submits via the agent-stream hook; on submit the parent's `onSubmit`
 * is responsible for setting the active run id (it returns the runId).
 */
export function Composer({ activeAgent, onSubmit, heroMode = false }: ComposerProps) {
  const draft = useUiStore((s) => s.composerDraft);
  const setDraft = useUiStore((s) => s.setComposerDraft);
  const selectedModelId = useUiStore((s) => s.selectedModelId);
  const setSelectedModelId = useUiStore((s) => s.setSelectedModelId);
  const { models } = useModels();
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { report } = useErrorReporter("composer");

  // Voice dictation lands in the composer live as the user speaks. Each pass
  // re-transcribes the whole take, so `applyTranscript` *replaces* the dictated
  // region: `dictationBaseRef` snapshots whatever was already typed when
  // recording started, and the transcript is appended after it.
  const dictationBaseRef = useRef("");
  const applyTranscript = useCallback(
    (text: string) => {
      const base = dictationBaseRef.current;
      // Safe single-space join: `base` is .trimEnd()'d at snapshot (line below),
      // and `text` is .trim()'d in the worker — so neither has leading/trailing spaces.
      const next =
        base.length > 0 && text.length > 0 ? `${base} ${text}` : base.length > 0 ? base : text;
      setDraft(next);
    },
    [setDraft],
  );
  const speech = useSpeechToText({ onTranscript: applyTranscript });
  // Snapshot the existing draft at the moment recording begins, then toggle.
  const handleMicToggle = useCallback(() => {
    if (speech.status === "idle") {
      dictationBaseRef.current = useUiStore.getState().composerDraft.trimEnd();
    }
    speech.toggle();
  }, [speech]);

  const mention = useMentionAutocomplete();

  // The coding agent is auto-provisioned for the active workspace + selected
  // model (see useEnsureDefaultAgent). "Ready" means that provisioning has
  // landed and the active agent actually runs the model the user picked — only
  // then is it safe to send, so a model switch never runs on the old model.
  const ready = activeAgent !== null && activeAgent.modelId === selectedModelId;

  // Phase 23 — options across all providers + Auto. Non-Cursor models carry a
  // "(Ask only)" badge since they have no tool-use. The current selection is
  // always present so the trigger renders correctly even mid-load.
  const modelOptions = useMemo<ReadonlyArray<SelectOption<string>>>(() => {
    const opts: SelectOption<string>[] = [{ value: AUTO_MODEL_ID, label: "✦ Auto" }];
    if (models.length > 0) {
      for (const m of models) {
        const suffix = m.provider === "cursor" ? "" : ` · ${PROVIDER_KIND_LABELS[m.provider]}`;
        const askOnly = m.capabilities.toolUse ? "" : " (Ask only)";
        opts.push({ value: m.id, label: `${m.name}${suffix}${askOnly}` });
      }
    } else {
      // Baseline before /api/models resolves: the built-in Cursor models.
      for (const id of Object.keys(MODEL_LABELS) as ModelId[]) {
        opts.push({ value: id, label: MODEL_LABELS[id] });
      }
    }
    if (!opts.some((o) => o.value === selectedModelId)) {
      opts.push({ value: selectedModelId, label: selectedModelId });
    }
    return opts;
  }, [models, selectedModelId]);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      // allSettled (R17-W3): a single unreadable file (FileReader error on a
      // corrupt/locked file) must not reject the whole batch and surface as an
      // unhandled rejection — keep the readable ones, toast the failures.
      const results = await Promise.allSettled(list.map(fileToAttachment));
      const converted: ComposerAttachment[] = [];
      let failures = 0;
      for (const r of results) {
        if (r.status === "fulfilled") converted.push(r.value);
        else failures += 1;
      }
      if (failures > 0) {
        report(`Couldn't read ${failures} file${failures === 1 ? "" : "s"}.`, {
          severity: "warn",
        });
      }
      if (converted.length === 0) return;
      setAttachments((prev) => {
        const merged = [...prev, ...converted];
        // Cap image attachments at the SDK-aligned max; file refs are unbounded.
        let images = 0;
        const capped = merged.filter((a) =>
          a.kind !== "image" ? true : ++images <= MAX_IMAGE_ATTACHMENTS,
        );
        if (capped.length < merged.length) {
          report(`At most ${MAX_IMAGE_ATTACHMENTS} images per message.`, { severity: "warn" });
        }
        return capped;
      });
    },
    [report],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const submit = useCallback(async () => {
    // Read the latest draft from the store at submit time rather than the
    // captured closure value — protects against programmatic updates racing
    // the captured snapshot.
    const trimmed = useUiStore.getState().composerDraft.trim();
    const current = attachments;
    if ((trimmed.length === 0 && current.length === 0) || busy) return;
    if (!activeAgent || activeAgent.modelId !== selectedModelId) {
      // The default agent is still provisioning (or switching models). The
      // Send button is disabled in this state; keyboard users hitting Enter
      // would otherwise get no feedback, so toast the same hint.
      report("Preparing the coding agent — try again in a moment.", { severity: "info" });
      return;
    }
    const images = attachmentImages(current);
    const promptText = `${trimmed}${fileReferenceText(current)}`.trim();
    // POST /api/runs requires a non-empty prompt (min length 1); if the user
    // attached only an image, synthesize a minimal instruction.
    const finalPrompt = promptText.length > 0 ? promptText : "(see attached image)";
    const mentions: ContextMention[] = mention.chips.map((c) => c.mention);
    setBusy(true);
    try {
      await onSubmit({
        prompt: finalPrompt,
        agentId: activeAgent.id,
        ...(images.length > 0 ? { images } : {}),
        ...(mentions.length > 0 ? { mentions } : {}),
      });
      setDraft("");
      setAttachments([]);
      mention.clearChips();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }, [activeAgent, selectedModelId, busy, onSubmit, setDraft, report, attachments, mention]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // Let the mention autocomplete handle navigation keys first
    if (mention.onKeyDown(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void addFiles(e.target.files);
    // Reset so picking the same file again re-fires change.
    e.target.value = "";
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragging) setDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  };

  const placeholder = heroMode
    ? "Plan, Build, / for commands, @ for context"
    : "Send a prompt to the coding agent…";

  const canSend = ready && !busy && (draft.trim().length > 0 || attachments.length > 0);

  // Reasoning effort knob intentionally absent. The Cursor SDK exposes
  // per-model parameters via `Cursor.models.list()[…].parameters` and the
  // run-time `model.params` field, but the harness has not yet wired model
  // discovery, so we render no control rather than a fake / always-disabled
  // one (spec's "honest about the SDK" rule).

  return (
    <div className={cn("composer", heroMode && "composer--hero")}>
      <WorkspaceSwitcher />
      <div
        className={cn("composer-box", dragging && "composer-box--dragover")}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={onFileInputChange}
          tabIndex={-1}
          aria-hidden="true"
        />
        <ContextChipBar chips={mention.chips} onRemove={mention.removeChip} />
        <div className="relative">
          <textarea
            className="composer-textarea"
            placeholder={placeholder}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              mention.onInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onKeyDown={onKeyDown}
            disabled={busy}
          />
          {mention.isOpen && mention.results ? (
            <MentionAutocomplete
              results={mention.results}
              selectedIndex={mention.selectedIndex}
              onSelect={mention.selectItem}
            />
          ) : null}
        </div>
        {attachments.length > 0 ? (
          <div className="composer-attachments">
            {attachments.map((a) => (
              <span key={a.id} className="composer-chip" title={a.name}>
                {a.kind === "image" ? (
                  <img src={a.previewUrl} alt="" className="composer-chip__thumb" />
                ) : (
                  <span className="composer-chip__file mono">{a.name.split(".").pop() ?? "file"}</span>
                )}
                <span className="composer-chip__name">{a.name}</span>
                <button
                  type="button"
                  className="composer-chip__remove"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => removeAttachment(a.id)}
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-2 flex items-center gap-1.5 text-xs text-text-tertiary">
          <button
            type="button"
            className="composer-add"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            aria-label="Attach files or images"
            title="Attach files or images"
          >
            <PlusIcon className="size-4" />
          </button>
          <Select
            value={selectedModelId}
            options={modelOptions}
            onChange={setSelectedModelId}
            disabled={busy}
            placement="top"
            ariaLabel="Model"
            title="Model used for new runs. Switching it re-targets the coding agent."
            className="h-control-md gap-1 rounded-md px-1 text-md font-medium text-text-tertiary hover:text-text-primary"
            leading={<SparkIcon className="size-3.5 shrink-0" />}
          />
          <div className="ml-auto flex items-center gap-2">
            {speech.modelProgress !== null ? (
              <span className="composer-stt-status" aria-live="polite">
                Loading voice model… {speech.modelProgress}%
              </span>
            ) : speech.status === "transcribing" ? (
              <span className="composer-stt-status" aria-live="polite">
                Transcribing…
              </span>
            ) : null}
            <button
              type="button"
              onClick={handleMicToggle}
              disabled={
                busy ||
                !speech.supported ||
                speech.status === "requesting" ||
                speech.status === "transcribing"
              }
              aria-pressed={speech.isRecording}
              aria-label={speech.isRecording ? "Stop recording" : "Record voice input"}
              title={
                speech.supported
                  ? speech.isRecording
                    ? "Stop recording"
                    : "Dictate with your microphone"
                  : "Voice input isn't available here"
              }
              className={cn("composer-mic", speech.isRecording && "composer-mic--recording")}
            >
              <MicIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSend}
              aria-label="Send"
              title={ready ? "Send" : "Preparing the coding agent…"}
              className="composer-send"
            >
              <ArrowUpIcon className="size-4" />
            </button>
          </div>
        </div>
      </div>
      {heroMode ? (
        <div className="composer-hero-hint">
          <span>Plan New Idea</span>
          <kbd className="composer-kbd">⏎ Tab</kbd>
        </div>
      ) : null}
    </div>
  );
}
