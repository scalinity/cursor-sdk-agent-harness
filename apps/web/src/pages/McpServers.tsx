import { useState } from "react";
import type { McpServerSummary } from "@harness/shared";
import { useMcpServers } from "../hooks/useMcpServers.js";
import { McpServerEditor } from "../components/settings/McpServerEditor.js";
import { StatusBadge } from "../components/settings/StatusBadge.js";
import { formatRelativeTime } from "../lib/format.js";

/**
 * MCP server settings page. Mounted at `/settings/mcp-servers`.
 * Spec §5 MCP Server CRUD.
 */
export function McpServers() {
  const { servers, loading, error, patch, remove, revalidate, reload } = useMcpServers();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<McpServerSummary | null>(null);

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (row: McpServerSummary) => {
    setEditing(row);
    setEditorOpen(true);
  };

  return (
    <main className="min-h-screen bg-background p-4 text-text-primary">
      <div className="mx-auto flex max-w-screen-xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
          <div>
            <h1 className="text-2xl font-semibold">MCP servers</h1>
            <p className="text-sm text-text-tertiary">
              Validate, enable, and assign MCP server definitions to your agents.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary"
              onClick={() => void reload()}
            >
              Refresh
            </button>
            <button
              type="button"
              className="h-control-md rounded-sm bg-accent-bg px-3 text-sm font-medium text-accent-primary"
              onClick={openCreate}
            >
              New MCP server
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-sm border border-danger bg-danger-bg p-3 text-sm text-danger">{error}</div>
        ) : null}

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-text-tertiary">
              <th className="border-b border-border-subtle py-2 pr-3">Name</th>
              <th className="border-b border-border-subtle py-2 pr-3">Transport</th>
              <th className="border-b border-border-subtle py-2 pr-3">Status</th>
              <th className="border-b border-border-subtle py-2 pr-3">Enabled</th>
              <th className="border-b border-border-subtle py-2 pr-3">Last checked</th>
              <th className="border-b border-border-subtle py-2 pr-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((srv) => (
              <tr key={srv.id} className="border-b border-border-subtle/60">
                <td className="py-2 pr-3 font-medium">{srv.name}</td>
                <td className="py-2 pr-3 font-mono text-xs uppercase text-text-tertiary">{srv.transport}</td>
                <td className="py-2 pr-3">
                  <StatusBadge
                    status={srv.validationStatus}
                    {...(srv.validationMessage ? { title: srv.validationMessage } : {})}
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="checkbox"
                    checked={srv.enabled}
                    onChange={(e) =>
                      void patch(srv.id, { enabled: e.currentTarget.checked })
                    }
                  />
                </td>
                <td className="py-2 pr-3 text-xs text-text-tertiary">
                  {formatRelativeTime(srv.lastCheckedAt) || "never"}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-sm border border-border-subtle px-2 py-0.5 text-xs text-text-secondary"
                      onClick={() => openEdit(srv)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-border-subtle px-2 py-0.5 text-xs text-text-secondary"
                      onClick={() => void revalidate(srv.id)}
                    >
                      Re-check
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-danger/40 px-2 py-0.5 text-xs text-danger"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete MCP server "${srv.name}"? Agents that reference it will lose access.`,
                          )
                        ) {
                          void remove(srv.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {servers.length === 0 && !loading ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-text-tertiary">
                  No MCP servers configured. Use &ldquo;New MCP server&rdquo; to add one.
                </td>
              </tr>
            ) : null}
            {loading ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-text-tertiary">
                  Loading…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <McpServerEditor
        key={editing?.id ?? "new-mcp"}
        existing={editing}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
      />
    </main>
  );
}
