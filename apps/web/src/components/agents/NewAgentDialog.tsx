/**
 * NewAgentDialog — the advanced agent composition surface (Phase 12).
 *
 * Tabs:
 *  - Basics:      name, mode (local/cloud), model.
 *  - Local:       settingSources, sandbox toggle, multi-cwd input with
 *                 inline workspace-allowlist quick-add.
 *  - Cloud:       JSON editor for CloudAgentOptions (OQ-16 verified).
 *  - MCP servers: multi-select against saved MCP rows.
 *  - Subagents:   multi-select against saved Subagent definitions.
 *
 * The footer's "Create agent" is gated by:
 *   - non-empty name
 *   - every local-mode cwd resolves to allowed
 *   - cloud-mode JSON parses against `cloudAgentOptionsSchema`
 *
 * On success: `useAgents.createAgent` POSTs the assembled payload to
 * `/api/agents`, sets the new agent active in the store, and closes the
 * dialog so the chat shell renders with the newly-created agent.
 */
import { useCallback, useMemo, useState } from "react";
import {
  cloudAgentOptionsSchema,
  MODEL_LABELS,
  modelIdSchema,
  type AgentMode,
  type CloudAgentOptions,
  type CreateAgentRequest,
  type McpServerSummary,
  type ModelId,
  type SettingSource,
  type SubagentSummary,
} from "@harness/shared";
import { useAgents } from "../../hooks/useAgents.js";
import { useMcpServers } from "../../hooks/useMcpServers.js";
import { useSubagents } from "../../hooks/useSubagents.js";
import {
  useWorkspaceAllowlist,
  type CwdDecision,
} from "../../hooks/useWorkspaceAllowlist.js";
import { CwdAllowlistChecker } from "./CwdAllowlistChecker.js";
import { StatusBadge } from "../settings/StatusBadge.js";

const SETTING_SOURCES: SettingSource[] = ["project", "user", "team", "mdm", "plugins", "all"];

export interface NewAgentDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (agentId: string) => void;
}

interface CwdRow {
  id: string;
  value: string;
  decision: CwdDecision | null;
  validating: boolean;
}

type TabId = "basics" | "local" | "cloud" | "mcp" | "subagents";

interface DialogState {
  name: string;
  mode: AgentMode;
  modelId: ModelId;
  settingSources: SettingSource[];
  sandboxEnabled: boolean;
  cwdRows: CwdRow[];
  cloudJsonText: string;
  cloudJsonError: string | null;
  selectedMcpIds: Set<string>;
  selectedSubagentIds: Set<string>;
  activeTab: TabId;
  saving: boolean;
  formError: string | null;
}

function initialDialogState(): DialogState {
  return {
    name: "",
    mode: "local",
    modelId: "composer-2-5-fast",
    settingSources: ["project", "user"],
    sandboxEnabled: true,
    cwdRows: [{ id: "cwd-0", value: "", decision: null, validating: false }],
    cloudJsonText: JSON.stringify(
      {
        env: { type: "cloud" },
        repos: [],
      } satisfies CloudAgentOptions,
      null,
      2,
    ),
    cloudJsonError: null,
    selectedMcpIds: new Set(),
    selectedSubagentIds: new Set(),
    activeTab: "basics",
    saving: false,
    formError: null,
  };
}

function newCwdRow(): CwdRow {
  return {
    id: `cwd-${Math.random().toString(36).slice(2, 8)}`,
    value: "",
    decision: null,
    validating: false,
  };
}

export function NewAgentDialog({ open, onClose, onCreated }: NewAgentDialogProps) {
  const { createAgent } = useAgents();
  const mcp = useMcpServers();
  const subs = useSubagents();
  const allowlist = useWorkspaceAllowlist();
  const [state, setState] = useState<DialogState>(() => initialDialogState());

  const setActiveTab = (tab: TabId) => setState((prev) => ({ ...prev, activeTab: tab }));

  const validateOne = useCallback(
    async (rowId: string) => {
      const target = state.cwdRows.find((r) => r.id === rowId);
      if (!target || !target.value.trim()) return;
      setState((prev) => ({
        ...prev,
        cwdRows: prev.cwdRows.map((r) =>
          r.id === rowId ? { ...r, validating: true } : r,
        ),
      }));
      try {
        const map = await allowlist.validateMany([target.value.trim()]);
        const decision = map.get(target.value.trim()) ?? null;
        setState((prev) => ({
          ...prev,
          cwdRows: prev.cwdRows.map((r) =>
            r.id === rowId ? { ...r, decision, validating: false } : r,
          ),
        }));
      } catch (e) {
        setState((prev) => ({
          ...prev,
          cwdRows: prev.cwdRows.map((r) =>
            r.id === rowId ? { ...r, validating: false } : r,
          ),
          formError: e instanceof Error ? e.message : "validate failed",
        }));
      }
    },
    [state.cwdRows, allowlist],
  );

  const addToAllowlist = useCallback(
    async (rowId: string) => {
      const target = state.cwdRows.find((r) => r.id === rowId);
      if (!target || !target.value.trim()) return;
      try {
        await allowlist.add({ path: target.value.trim(), recursive: true });
        await validateOne(rowId);
      } catch (e) {
        setState((prev) => ({
          ...prev,
          formError: e instanceof Error ? e.message : "add-to-allowlist failed",
        }));
      }
    },
    [state.cwdRows, allowlist, validateOne],
  );

  const onCloudJsonChange = useCallback((next: string) => {
    setState((prev) => ({ ...prev, cloudJsonText: next, cloudJsonError: null }));
  }, []);

  const onCloudJsonBlur = useCallback(() => {
    setState((prev) => {
      try {
        const parsed = cloudAgentOptionsSchema.safeParse(JSON.parse(prev.cloudJsonText));
        return {
          ...prev,
          cloudJsonError: parsed.success ? null : parsed.error.issues[0]?.message ?? "invalid",
        };
      } catch (e) {
        return {
          ...prev,
          cloudJsonError: e instanceof Error ? e.message : "invalid JSON",
        };
      }
    });
  }, []);

  const blockers = useMemo(() => collectBlockers(state), [state]);

  const submit = useCallback(async () => {
    if (blockers.length > 0) {
      setState((prev) => ({
        ...prev,
        formError: `Fix ${blockers.length} blocker(s) before creating: ${blockers.join("; ")}`,
      }));
      return;
    }
    setState((prev) => ({ ...prev, saving: true, formError: null }));
    const payload = assemblePayload(state);
    if (!payload) {
      setState((prev) => ({
        ...prev,
        saving: false,
        formError: "Failed to assemble agent payload (check fields).",
      }));
      return;
    }
    try {
      const created = await createAgent(payload);
      onCreated?.(created.id);
      onClose();
      setState(initialDialogState());
    } catch (e) {
      setState((prev) => ({
        ...prev,
        saving: false,
        formError: e instanceof Error ? e.message : "create failed",
      }));
    }
  }, [blockers, state, createAgent, onCreated, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-background/70 p-6">
      <div className="flex w-full max-w-3xl flex-col gap-3 rounded-md border border-border-strong bg-surface-1 p-4 text-sm text-text-primary shadow-lg">
        <header className="flex items-center justify-between border-b border-border-subtle pb-2">
          <h2 className="text-base font-semibold">New agent</h2>
          <button
            type="button"
            className="rounded-sm border border-border-subtle px-2 py-1 text-xs text-text-secondary hover:bg-surface-2"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <nav className="flex gap-1 border-b border-border-subtle text-sm">
          {(["basics", "local", "cloud", "mcp", "subagents"] as TabId[]).map((tab) => {
            const hidden =
              (state.mode === "local" && tab === "cloud") ||
              (state.mode === "cloud" && tab === "local");
            if (hidden) return null;
            const isActive = state.activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                className={`h-control-md rounded-sm px-3 text-xs ${
                  isActive
                    ? "bg-accent-bg text-accent-primary"
                    : "border border-transparent text-text-tertiary hover:border-border-subtle"
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            );
          })}
        </nav>

        {blockers.length > 0 ? (
          <div className="rounded-sm border border-warning/40 bg-warning-bg/40 p-2 text-xs text-warning">
            {blockers.length} issue{blockers.length === 1 ? "" : "s"}: {blockers.join("; ")}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 overflow-y-auto">
          {state.activeTab === "basics" ? (
            <BasicsTab
              state={state}
              setState={setState}
              onModeChange={(mode) =>
                setState((prev) => ({
                  ...prev,
                  mode,
                  activeTab: mode === "local" ? "local" : "cloud",
                }))
              }
            />
          ) : null}
          {state.activeTab === "local" ? (
            <LocalTab
              state={state}
              setState={setState}
              onValidateRow={validateOne}
              onAddToAllowlist={addToAllowlist}
            />
          ) : null}
          {state.activeTab === "cloud" ? (
            <CloudTab
              state={state}
              onChange={onCloudJsonChange}
              onBlur={onCloudJsonBlur}
            />
          ) : null}
          {state.activeTab === "mcp" ? (
            <McpTab state={state} setState={setState} servers={mcp.servers} />
          ) : null}
          {state.activeTab === "subagents" ? (
            <SubagentsTab state={state} setState={setState} subagents={subs.subagents} />
          ) : null}
        </div>

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
            disabled={state.saving || blockers.length > 0}
            className="h-control-md rounded-sm bg-accent-bg px-3 text-sm font-medium text-accent-primary disabled:opacity-50"
            onClick={() => void submit()}
          >
            {state.saving ? "Creating…" : "Create agent"}
          </button>
        </footer>
      </div>
    </div>
  );
}

const TAB_LABELS: Record<TabId, string> = {
  basics: "Basics",
  local: "Local",
  cloud: "Cloud",
  mcp: "MCP servers",
  subagents: "Subagents",
};

interface TabProps {
  state: DialogState;
  setState: React.Dispatch<React.SetStateAction<DialogState>>;
}

function BasicsTab({
  state,
  setState,
  onModeChange,
}: TabProps & { onModeChange: (mode: AgentMode) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-text-tertiary">Name</span>
        <input
          type="text"
          className="h-control-md rounded-sm border border-border-subtle bg-surface-2 px-2 text-sm"
          value={state.name}
          onChange={(e) => setState((prev) => ({ ...prev, name: e.currentTarget.value }))}
        />
      </label>
      <fieldset className="flex items-center gap-3 rounded-sm border border-border-subtle p-2">
        <legend className="px-1 text-xs text-text-tertiary">Mode</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="agent-mode"
            checked={state.mode === "local"}
            onChange={() => onModeChange("local")}
          />
          <span>Local</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="agent-mode"
            checked={state.mode === "cloud"}
            onChange={() => onModeChange("cloud")}
          />
          <span>Cloud</span>
        </label>
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-text-tertiary">Model</span>
        <select
          className="h-control-md rounded-sm border border-border-subtle bg-surface-2 px-2 text-sm"
          value={state.modelId}
          onChange={(e) =>
            setState((prev) => ({
              ...prev,
              modelId: modelIdSchema.parse(e.currentTarget.value),
            }))
          }
        >
          {Object.entries(MODEL_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function LocalTab({
  state,
  setState,
  onValidateRow,
  onAddToAllowlist,
}: TabProps & {
  onValidateRow: (rowId: string) => void;
  onAddToAllowlist: (rowId: string) => void;
}) {
  const toggleSource = (src: SettingSource) => {
    setState((prev) => {
      const has = prev.settingSources.includes(src);
      if (has) {
        return { ...prev, settingSources: prev.settingSources.filter((s) => s !== src) };
      }
      // `all` is mutually exclusive with other sources (per spec §5).
      if (src === "all") return { ...prev, settingSources: ["all"] };
      return {
        ...prev,
        settingSources: [...prev.settingSources.filter((s) => s !== "all"), src],
      };
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="rounded-sm border border-border-subtle p-2">
        <legend className="px-1 text-xs text-text-tertiary">settingSources</legend>
        <div className="flex flex-wrap gap-2">
          {SETTING_SOURCES.map((src) => (
            <label key={src} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={state.settingSources.includes(src)}
                onChange={() => toggleSource(src)}
              />
              <span>{src}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={state.sandboxEnabled}
          onChange={(e) =>
            setState((prev) => ({ ...prev, sandboxEnabled: e.currentTarget.checked }))
          }
        />
        <span>Sandbox enabled (file-write + network gated by the platform sandbox)</span>
      </label>

      <fieldset className="rounded-sm border border-border-subtle p-2">
        <legend className="px-1 text-xs text-text-tertiary">Workspaces (cwd)</legend>
        <div className="flex flex-col gap-2">
          {state.cwdRows.map((row, idx) => (
            <div key={row.id} className="flex flex-col gap-1 rounded-sm border border-border-subtle/60 p-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="/path/to/repo"
                  className="h-control-md flex-1 rounded-sm border border-border-subtle bg-surface-2 px-2 text-sm font-mono"
                  value={row.value}
                  onChange={(e) =>
                    setState((prev) => ({
                      ...prev,
                      cwdRows: prev.cwdRows.map((r) =>
                        r.id === row.id ? { ...r, value: e.currentTarget.value, decision: null } : r,
                      ),
                    }))
                  }
                  onBlur={() => onValidateRow(row.id)}
                />
                <button
                  type="button"
                  className="rounded-sm border border-border-subtle px-2 py-0.5 text-xs text-text-secondary"
                  disabled={state.cwdRows.length === 1 && idx === 0}
                  onClick={() =>
                    setState((prev) => ({
                      ...prev,
                      cwdRows: prev.cwdRows.filter((r) => r.id !== row.id),
                    }))
                  }
                >
                  Remove
                </button>
              </div>
              <CwdAllowlistChecker
                decision={row.decision}
                loading={row.validating}
                onAddToAllowlist={() => onAddToAllowlist(row.id)}
                onRevalidate={() => onValidateRow(row.id)}
              />
            </div>
          ))}
          <button
            type="button"
            className="self-start rounded-sm border border-border-subtle px-2 py-1 text-xs text-text-secondary"
            onClick={() =>
              setState((prev) => ({ ...prev, cwdRows: [...prev.cwdRows, newCwdRow()] }))
            }
          >
            Add workspace
          </button>
        </div>
      </fieldset>
    </div>
  );
}

function CloudTab({
  state,
  onChange,
  onBlur,
}: {
  state: DialogState;
  onChange: (next: string) => void;
  onBlur: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-sm border border-border-subtle bg-surface-2/60 p-2 text-xs text-text-tertiary">
        CloudAgentOptions schema verified (OQ-16). Fields:{" "}
        <code className="font-mono">env, repos[], workOnCurrentBranch, autoCreatePR, skipReviewerRequest, envVars</code>
        .
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-text-tertiary">CloudAgentOptions (JSON)</span>
        <textarea
          rows={14}
          spellCheck={false}
          className="resize-y rounded-sm border border-border-subtle bg-surface-2 p-2 font-mono text-xs"
          value={state.cloudJsonText}
          onChange={(e) => onChange(e.currentTarget.value)}
          onBlur={onBlur}
        />
      </label>
      {state.cloudJsonError ? (
        <p className="text-xs text-danger">{state.cloudJsonError}</p>
      ) : null}
    </div>
  );
}

function McpTab({
  state,
  setState,
  servers,
}: TabProps & { servers: McpServerSummary[] }) {
  const toggle = (id: string) => {
    setState((prev) => {
      const next = new Set(prev.selectedMcpIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, selectedMcpIds: next };
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-text-tertiary">
        Servers must be marked Enabled to surface here. Manage servers in the MCP settings page.
      </p>
      {servers.length === 0 ? (
        <p className="text-xs text-text-tertiary">No MCP servers configured.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {servers.map((srv) => (
            <li key={srv.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={state.selectedMcpIds.has(srv.id)}
                onChange={() => toggle(srv.id)}
                disabled={!srv.enabled}
              />
              <span className="font-medium">{srv.name}</span>
              <span className="text-xs text-text-tertiary">{srv.transport}</span>
              <StatusBadge status={srv.validationStatus} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SubagentsTab({
  state,
  setState,
  subagents,
}: TabProps & { subagents: SubagentSummary[] }) {
  const toggle = (id: string) => {
    setState((prev) => {
      const next = new Set(prev.selectedSubagentIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, selectedSubagentIds: next };
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-text-tertiary">
        Saved subagent definitions. Disabled rows are dimmed and cannot be selected.
      </p>
      {subagents.length === 0 ? (
        <p className="text-xs text-text-tertiary">No subagent definitions yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {subagents.map((sub) => (
            <li key={sub.id} className={`flex items-center gap-2 ${sub.enabled ? "" : "opacity-50"}`}>
              <input
                type="checkbox"
                checked={state.selectedSubagentIds.has(sub.id)}
                onChange={() => toggle(sub.id)}
                disabled={!sub.enabled}
              />
              <span className="font-medium">{sub.name}</span>
              <span className="text-xs text-text-tertiary">{sub.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Aggregate every save-time problem so the dialog can show a single
 * banner. Empty array means "free to submit".
 */
function collectBlockers(state: DialogState): string[] {
  const issues: string[] = [];
  if (!state.name.trim()) issues.push("name");
  if (state.mode === "local") {
    if (state.cwdRows.every((r) => !r.value.trim())) {
      issues.push("at least one cwd");
    } else {
      for (const row of state.cwdRows) {
        if (!row.value.trim()) continue;
        if (row.decision === null) {
          issues.push(`cwd not yet validated (${row.value.trim()})`);
          continue;
        }
        if (!row.decision.allowed) {
          issues.push(`cwd not allowlisted (${row.value.trim()})`);
        }
      }
    }
    if (
      state.settingSources.includes("all") &&
      state.settingSources.length > 1
    ) {
      issues.push("settingSources 'all' is mutually exclusive");
    }
  } else {
    if (state.cloudJsonError) issues.push(`cloud options invalid: ${state.cloudJsonError}`);
    try {
      const parsed = cloudAgentOptionsSchema.safeParse(JSON.parse(state.cloudJsonText));
      if (!parsed.success) {
        issues.push(`cloud options invalid: ${parsed.error.issues[0]?.message ?? "shape mismatch"}`);
      }
    } catch (e) {
      issues.push(`cloud options JSON parse error: ${e instanceof Error ? e.message : "?"}`);
    }
  }
  return issues;
}

function assemblePayload(state: DialogState): CreateAgentRequest | null {
  if (state.mode === "local") {
    const cwd = state.cwdRows
      .map((r) => r.value.trim())
      .filter((p) => p.length > 0);
    return {
      name: state.name.trim(),
      mode: "local",
      modelId: state.modelId,
      cwd,
      settingSources: state.settingSources,
      sandboxEnabled: state.sandboxEnabled,
      mcpServerIds: Array.from(state.selectedMcpIds),
      subagentDefinitionIds: Array.from(state.selectedSubagentIds),
    };
  }
  // Cloud
  let cloudOptions: CloudAgentOptions;
  try {
    cloudOptions = cloudAgentOptionsSchema.parse(JSON.parse(state.cloudJsonText));
  } catch {
    return null;
  }
  return {
    name: state.name.trim(),
    mode: "cloud",
    modelId: state.modelId,
    cloudOptions,
    mcpServerIds: Array.from(state.selectedMcpIds),
    subagentDefinitionIds: Array.from(state.selectedSubagentIds),
  };
}
