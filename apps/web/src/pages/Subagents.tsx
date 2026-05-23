import { useState } from "react";
import { MODEL_LABELS, type ModelId, type SubagentSummary } from "@harness/shared";
import { useMcpServers } from "../hooks/useMcpServers.js";
import { useSubagents } from "../hooks/useSubagents.js";
import { SubagentEditor } from "../components/settings/SubagentEditor.js";

function modelLabelFor(model: SubagentSummary["model"]): string {
  if (model === null) return "Inherit";
  return MODEL_LABELS[model.id as ModelId] ?? model.id;
}

function mcpChips(ids: ReadonlyArray<string>, names: Map<string, string>): string {
  if (ids.length === 0) return "—";
  return ids.map((id) => names.get(id) ?? id.slice(0, 6)).join(", ");
}

function truncate(text: string, limit = 80): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/**
 * Subagent settings page. Mounted at `/settings/subagents`.
 * Spec §5 Subagent CRUD.
 */
export function Subagents() {
  const subagents = useSubagents();
  const mcp = useMcpServers();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SubagentSummary | null>(null);

  const namesByMcpId = new Map(mcp.servers.map((s) => [s.id, s.name]));

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (row: SubagentSummary) => {
    setEditing(row);
    setEditorOpen(true);
  };

  return (
    <main className="min-h-screen bg-background p-4 text-text-primary">
      <div className="mx-auto flex max-w-screen-xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
          <div>
            <h1 className="text-2xl font-semibold">Subagents</h1>
            <p className="text-sm text-text-tertiary">
              Reusable subagent definitions wired into your parent agents.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary"
              onClick={() => void subagents.reload()}
            >
              Refresh
            </button>
            <button
              type="button"
              className="h-control-md rounded-sm bg-accent-bg px-3 text-sm font-medium text-accent-primary"
              onClick={openCreate}
            >
              New subagent
            </button>
          </div>
        </header>

        {subagents.error ? (
          <div className="rounded-sm border border-danger bg-danger-bg p-3 text-sm text-danger">
            {subagents.error}
          </div>
        ) : null}

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-text-tertiary">
              <th className="border-b border-border-subtle py-2 pr-3">Name</th>
              <th className="border-b border-border-subtle py-2 pr-3">Enabled</th>
              <th className="border-b border-border-subtle py-2 pr-3">Model</th>
              <th className="border-b border-border-subtle py-2 pr-3">MCP servers</th>
              <th className="border-b border-border-subtle py-2 pr-3">Description</th>
              <th className="border-b border-border-subtle py-2 pr-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {subagents.subagents.map((sub) => (
              <tr key={sub.id} className="border-b border-border-subtle/60">
                <td className="py-2 pr-3 font-medium">{sub.name}</td>
                <td className="py-2 pr-3">
                  <input
                    type="checkbox"
                    checked={sub.enabled}
                    onChange={(e) =>
                      void subagents.patch(sub.id, { enabled: e.currentTarget.checked })
                    }
                  />
                </td>
                <td className="py-2 pr-3 text-xs text-text-tertiary">{modelLabelFor(sub.model)}</td>
                <td className="py-2 pr-3 text-xs text-text-tertiary">
                  {mcpChips(sub.mcpServerIds, namesByMcpId)}
                </td>
                <td className="py-2 pr-3 text-xs text-text-tertiary">{truncate(sub.description)}</td>
                <td className="py-2 pr-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-sm border border-border-subtle px-2 py-0.5 text-xs text-text-secondary"
                      onClick={() => openEdit(sub)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-danger/40 px-2 py-0.5 text-xs text-danger"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete subagent "${sub.name}"? Agents referencing it will lose it.`,
                          )
                        ) {
                          void subagents.remove(sub.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {subagents.subagents.length === 0 && !subagents.loading ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-text-tertiary">
                  No subagent definitions yet. Use &ldquo;New subagent&rdquo; to add one.
                </td>
              </tr>
            ) : null}
            {subagents.loading ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-text-tertiary">
                  Loading…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <SubagentEditor
        key={editing?.id ?? "new-subagent"}
        existing={editing}
        open={editorOpen}
        mcpServers={mcp.servers}
        onClose={() => setEditorOpen(false)}
      />
    </main>
  );
}
