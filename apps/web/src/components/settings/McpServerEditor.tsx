/**
 * SECURITY (REVIEW-W10): This component's state holds the raw MCP
 * server config — including secrets — between the user's "Reveal
 * secrets" click and the dialog close. Any future global error
 * reporter, redux devtools snapshot, or session-replay capture MUST
 * exclude this component's state. There is no opt-out plumbing yet;
 * adding one here would be the place. If you add a project-wide
 * state-snapshot mechanism, exempt `McpServerEditor` explicitly.
 */
import { useCallback, useMemo, useState } from "react";
import {
  mcpServerConfigSchema,
  parseJsonWithSchema,
  type CreateMcpServerRequest,
  type McpServerConfig,
  type McpServerSummary,
} from "@harness/shared";
import { useMcpServers } from "../../hooks/useMcpServers.js";
import { StatusBadge } from "./StatusBadge.js";

export interface McpServerEditorProps {
  /** Existing summary when editing; null for create. */
  existing: McpServerSummary | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (next: McpServerSummary) => void;
}

interface EditorState {
  name: string;
  enabled: boolean;
  configText: string;
  configError: string | null;
  formError: string | null;
  saving: boolean;
  revealedRaw: boolean;
}

function blankState(): EditorState {
  const initial: McpServerConfig = { command: "" };
  return {
    name: "",
    enabled: true,
    configText: JSON.stringify(initial, null, 2),
    configError: null,
    formError: null,
    saving: false,
    revealedRaw: false,
  };
}

/**
 * Mirrors the server-side `containsRedactedSentinel` in mcp-servers.routes.ts.
 * REVIEW-C1: refuse to save a config containing the `[REDACTED]` placeholder
 * because that would persist the placeholder as the real secret.
 */
function containsRedactedSentinel(value: unknown): boolean {
  if (value === "[REDACTED]") return true;
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (containsRedactedSentinel(child)) return true;
    }
  }
  return false;
}

// REVIEW-S4: delegate to the shared parseJsonWithSchema helper.
function tryParse(text: string): { value: McpServerConfig | null; error: string | null } {
  return parseJsonWithSchema(text, mcpServerConfigSchema);
}

/**
 * McpServerEditor — paired with `/settings/mcp-servers` page. Persists
 * via the create/replace endpoints; the save handler does NOT run a
 * separate client probe — the server runs the probe and the response
 * carries the verdict.
 *
 * Token-bearing fields stay masked until the user clicks "Reveal" which
 * fetches the unredacted config via `useMcpServers.reveal`. Reveal is
 * per-server, not session-wide, so a Cancel discards the raw value.
 */
export function McpServerEditor({ existing, open, onClose, onSaved }: McpServerEditorProps) {
  const isEditing = existing !== null;
  const { create, replace, reveal } = useMcpServers();
  // Initialized once per mount. The parent rotates this component's `key`
  // when `existing.id` changes, so React remounts and re-runs the lazy
  // initializer — no in-component reset effect needed.
  const [state, setState] = useState<EditorState>(() => initialEditorState(existing));

  const parsed = useMemo(() => tryParse(state.configText), [state.configText]);

  const onConfigChange = useCallback((next: string) => {
    setState((prev) => ({
      ...prev,
      configText: next,
      configError: null,
    }));
  }, []);

  const onConfigBlur = useCallback(() => {
    setState((prev) => {
      const { error } = tryParse(prev.configText);
      return {
        ...prev,
        configError: error,
      };
    });
  }, []);

  const onReveal = useCallback(async () => {
    if (!existing) return;
    try {
      const revealed = await reveal(existing.id);
      setState((prev) => ({
        ...prev,
        revealedRaw: true,
        configText: JSON.stringify(revealed.config, null, 2),
        configError: null,
      }));
    } catch (e) {
      setState((prev) => ({
        ...prev,
        formError: e instanceof Error ? e.message : "reveal failed",
      }));
    }
  }, [existing, reveal]);

  const save = useCallback(async () => {
    const { value, error } = tryParse(state.configText);
    if (!value || error) {
      setState((prev) => ({ ...prev, configError: error ?? "config invalid" }));
      return;
    }
    if (!state.name.trim()) {
      setState((prev) => ({ ...prev, formError: "Name is required." }));
      return;
    }
    // REVIEW-C1 guard: a list-view config carries `[REDACTED]` placeholders
    // for token-bearing fields. Saving from the editor without first
    // clicking "Reveal secrets" would persist those placeholders, destroying
    // the real stored secrets. Refuse the save and prompt the user. (The
    // server enforces the same rule via `REDACTED_SENTINEL_PRESENT`.)
    if (existing && !state.revealedRaw && containsRedactedSentinel(value)) {
      setState((prev) => ({
        ...prev,
        formError:
          "Click 'Reveal secrets' before saving — otherwise the redacted placeholders would overwrite the stored tokens.",
      }));
      return;
    }
    setState((prev) => ({ ...prev, saving: true, formError: null }));
    const payload: CreateMcpServerRequest = {
      name: state.name.trim(),
      enabled: state.enabled,
      config: value,
    };
    try {
      const next = existing
        ? await replace(existing.id, payload)
        : await create(payload);
      onSaved?.(next);
      onClose();
    } catch (e) {
      setState((prev) => ({
        ...prev,
        saving: false,
        formError: e instanceof Error ? e.message : "save failed",
      }));
    }
  }, [state, existing, replace, create, onSaved, onClose]);

  if (!open) return null;

  const configIsValid = parsed.value !== null && parsed.error === null;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-background/70 p-6">
      <div className="flex w-full max-w-2xl flex-col gap-3 rounded-md border border-border-strong bg-surface-1 p-4 text-sm text-text-primary shadow-lg">
        <header className="flex items-center justify-between border-b border-border-subtle pb-2">
          <div>
            <h2 className="text-base font-semibold">
              {isEditing ? `Edit MCP server "${existing.name}"` : "New MCP server"}
            </h2>
            {isEditing ? (
              <p className="mt-0.5 text-xs text-text-tertiary">
                <StatusBadge status={existing.validationStatus} /> &nbsp;
                {existing.validationMessage ?? "no validation message"}
              </p>
            ) : null}
          </div>
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

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => setState((prev) => ({ ...prev, enabled: e.currentTarget.checked }))}
          />
          <span>Enabled</span>
        </label>

        <div className="flex items-center justify-between">
          <label className="text-xs text-text-tertiary" htmlFor="mcp-config-textarea">
            Config (JSON) — {configIsValid ? "valid" : "needs review"}
          </label>
          {isEditing && !state.revealedRaw ? (
            <button
              type="button"
              className="rounded-sm border border-border-subtle px-2 py-0.5 text-xs text-text-secondary hover:bg-surface-2"
              onClick={() => void onReveal()}
            >
              Reveal secrets
            </button>
          ) : null}
        </div>
        <textarea
          id="mcp-config-textarea"
          rows={10}
          className="resize-y rounded-sm border border-border-subtle bg-surface-2 p-2 font-mono text-xs text-text-primary"
          spellCheck={false}
          value={state.configText}
          onChange={(e) => onConfigChange(e.currentTarget.value)}
          onBlur={onConfigBlur}
        />
        {state.configError ? (
          <p className="text-xs text-danger">Config error: {state.configError}</p>
        ) : null}

        {state.formError ? (
          <p className="text-xs text-danger">{state.formError}</p>
        ) : null}

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
            disabled={state.saving || !configIsValid || !state.name.trim()}
            className="h-control-md rounded-sm bg-accent-bg px-3 text-sm font-medium text-accent-primary disabled:opacity-50"
            onClick={() => void save()}
          >
            {state.saving ? "Saving…" : "Save and probe"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function initialEditorState(existing: McpServerSummary | null): EditorState {
  if (!existing) return blankState();
  const text = JSON.stringify(existing.configRedacted, null, 2);
  const { error } = tryParse(text);
  return {
    name: existing.name,
    enabled: existing.enabled,
    configText: text,
    configError: error,
    formError: null,
    saving: false,
    revealedRaw: false,
  };
}
