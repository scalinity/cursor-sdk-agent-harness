import { useCallback, useState } from "react";
import {
  MODEL_LABELS,
  modelIdSchema,
  type CreateSubagentRequest,
  type McpServerSummary,
  type ModelId,
  type SubagentSummary,
} from "@harness/shared";
import { useSubagents } from "../../hooks/useSubagents.js";
import { Select, type SelectOption } from "../ui/Select.js";

/** Known models for the override dropdown. */
const MODEL_OPTIONS: ReadonlyArray<SelectOption<ModelId>> = (
  Object.keys(MODEL_LABELS) as ModelId[]
).map((id) => ({ value: id, label: MODEL_LABELS[id] }));

export interface SubagentEditorProps {
  existing: SubagentSummary | null;
  open: boolean;
  mcpServers: McpServerSummary[];
  onClose: () => void;
  onSaved?: (next: SubagentSummary) => void;
}

interface EditorState {
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
  modelInherit: boolean;
  modelId: ModelId;
  selectedMcpIds: Set<string>;
  saving: boolean;
  error: string | null;
  /**
   * REVIEW-W6: when the existing model id is NOT in this build's
   * `modelIdSchema` (e.g. persisted by a future SDK or another tool),
   * we preserve it here so the user can keep using it instead of being
   * silently downgraded to the harness default. The override picker is
   * locked in this case to avoid an accidental overwrite.
   */
  unknownModelId: string | null;
}

function initialState(existing: SubagentSummary | null): EditorState {
  const hasOverride = existing?.model !== null && existing?.model !== undefined;
  const overrideId = hasOverride && existing?.model ? existing.model.id : null;
  const overrideIsKnown =
    overrideId !== null && modelIdSchema.safeParse(overrideId).success;
  return {
    name: existing?.name ?? "",
    description: existing?.description ?? "",
    prompt: existing?.prompt ?? "",
    enabled: existing?.enabled ?? true,
    modelInherit: existing ? existing.model === null : true,
    modelId:
      overrideIsKnown && overrideId !== null
        ? (overrideId as ModelId)
        : "composer-2-5-fast",
    unknownModelId: hasOverride && !overrideIsKnown ? overrideId : null,
    selectedMcpIds: new Set(existing?.mcpServerIds ?? []),
    saving: false,
    error: null,
  };
}

/**
 * SubagentEditor — paired with `/settings/subagents` page. Subagent
 * `model` accepts inherit (null) or an explicit `{ id }` override; the
 * editor toggles between the two.
 *
 * `mcpServerIds` is multi-select against the parent's saved MCP servers.
 * Invalid/unreachable servers are dimmed but still pickable (per the
 * phase prompt — the user may want to assign a server that's currently
 * down and re-validate later). Disabled MCP servers are hidden because
 * a deliberately-off server doesn't belong on a new subagent.
 */
export function SubagentEditor({ existing, open, mcpServers, onClose, onSaved }: SubagentEditorProps) {
  const isEditing = existing !== null;
  const { create, replace } = useSubagents();
  // Initialized once per mount. The parent rotates `key` on `existing.id`
  // change, so React remounts and re-runs the lazy initializer instead
  // of using a reset effect.
  const [state, setState] = useState<EditorState>(() => initialState(existing));

  const toggleMcp = useCallback((id: string) => {
    setState((prev) => {
      const next = new Set(prev.selectedMcpIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, selectedMcpIds: next };
    });
  }, []);

  const save = useCallback(async () => {
    if (!state.name.trim()) {
      setState((prev) => ({ ...prev, error: "Name is required." }));
      return;
    }
    if (!state.description.trim()) {
      setState((prev) => ({ ...prev, error: "Description is required." }));
      return;
    }
    if (!state.prompt.trim()) {
      setState((prev) => ({ ...prev, error: "Prompt is required." }));
      return;
    }
    setState((prev) => ({ ...prev, saving: true, error: null }));
    // REVIEW-W6: preserve the unknown model id if the user kept "Override"
    // selected without picking a known id from the dropdown. The dropdown
    // is locked in that case so any explicit selection (which clears
    // `unknownModelId`) wins; otherwise we round-trip the original value
    // instead of silently downgrading to the harness default.
    const overrideId =
      state.unknownModelId !== null ? state.unknownModelId : state.modelId;
    const payload: CreateSubagentRequest = {
      name: state.name.trim(),
      description: state.description.trim(),
      prompt: state.prompt,
      enabled: state.enabled,
      model: state.modelInherit ? null : { id: overrideId },
      mcpServerIds: Array.from(state.selectedMcpIds),
    };
    try {
      const next = existing ? await replace(existing.id, payload) : await create(payload);
      onSaved?.(next);
      onClose();
    } catch (e) {
      setState((prev) => ({
        ...prev,
        saving: false,
        error: e instanceof Error ? e.message : "save failed",
      }));
    }
  }, [state, existing, create, replace, onSaved, onClose]);

  if (!open) return null;

  const visibleMcp = mcpServers.filter((m) => m.enabled);

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-background/70 p-6">
      <div className="flex w-full max-w-2xl flex-col gap-3 rounded-md border border-border-strong bg-surface-1 p-4 text-sm text-text-primary shadow-lg">
        <header className="flex items-center justify-between border-b border-border-subtle pb-2">
          <h2 className="text-base font-semibold">
            {isEditing ? `Edit subagent "${existing.name}"` : "New subagent"}
          </h2>
          <button
            type="button"
            className="rounded-sm border border-border-subtle px-2 py-1 text-xs text-text-secondary hover:bg-surface-2"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-tertiary">Name</span>
          <input
            type="text"
            className="h-control-md rounded-sm border border-border-subtle bg-surface-2 px-2 text-sm text-text-primary"
            value={state.name}
            onChange={(e) => setState((prev) => ({ ...prev, name: e.currentTarget.value }))}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-tertiary">Description</span>
          <input
            type="text"
            className="h-control-md rounded-sm border border-border-subtle bg-surface-2 px-2 text-sm text-text-primary"
            value={state.description}
            onChange={(e) =>
              setState((prev) => ({ ...prev, description: e.currentTarget.value }))
            }
          />
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => setState((prev) => ({ ...prev, enabled: e.currentTarget.checked }))}
          />
          <span>Enabled</span>
        </label>

        <fieldset className="rounded-sm border border-border-subtle p-2">
          <legend className="px-1 text-xs text-text-tertiary">Model</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="subagent-model"
              checked={state.modelInherit}
              onChange={() => setState((prev) => ({ ...prev, modelInherit: true }))}
            />
            <span>Inherit from parent agent</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="subagent-model"
              checked={!state.modelInherit}
              onChange={() => setState((prev) => ({ ...prev, modelInherit: false }))}
            />
            <span>Override:</span>
            <Select
              disabled={state.modelInherit || state.unknownModelId !== null}
              value={state.modelId}
              options={MODEL_OPTIONS}
              onChange={(modelId) =>
                setState((prev) => ({ ...prev, modelId, unknownModelId: null }))
              }
              className="h-control-md rounded-sm border border-border-subtle bg-surface-2 px-2 text-sm text-text-primary"
            />
          </label>
          {state.unknownModelId !== null ? (
            <p className="mt-1 text-xs text-warning">
              Existing model id <code className="font-mono">{state.unknownModelId}</code>{" "}
              is not in this build&apos;s known list. Saving keeps it as-is. Pick a known
              id from the dropdown above to replace it.
            </p>
          ) : null}
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-tertiary">Prompt</span>
          <textarea
            rows={12}
            spellCheck={false}
            className="resize-y rounded-sm border border-border-subtle bg-surface-2 p-2 font-mono text-xs text-text-primary"
            value={state.prompt}
            onChange={(e) => setState((prev) => ({ ...prev, prompt: e.currentTarget.value }))}
          />
          <span className="self-end text-xs text-text-tertiary">{state.prompt.length} chars</span>
        </label>

        <fieldset className="rounded-sm border border-border-subtle p-2">
          <legend className="px-1 text-xs text-text-tertiary">MCP servers (scoped)</legend>
          {visibleMcp.length === 0 ? (
            <p className="text-xs text-text-tertiary">
              No enabled MCP servers. Configure servers in MCP settings first.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {visibleMcp.map((srv) => {
                const dim = srv.validationStatus !== "valid" && srv.validationStatus !== "unknown";
                return (
                  <li key={srv.id} className={`flex items-center gap-2 ${dim ? "opacity-60" : ""}`}>
                    <input
                      type="checkbox"
                      checked={state.selectedMcpIds.has(srv.id)}
                      onChange={() => toggleMcp(srv.id)}
                    />
                    <span className="font-medium">{srv.name}</span>
                    <span className="text-xs text-text-tertiary">
                      {srv.transport} · {srv.validationStatus}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>

        {state.error ? <p className="text-xs text-danger">{state.error}</p> : null}

        <footer className="flex items-center justify-end gap-2 border-t border-border-subtle pt-2">
          <button
            type="button"
            className="h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={state.saving}
            className="h-control-md rounded-sm bg-accent-bg px-3 text-sm font-medium text-accent-primary disabled:opacity-50"
            onClick={() => void save()}
          >
            {state.saving ? "Saving…" : isEditing ? "Save" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}
