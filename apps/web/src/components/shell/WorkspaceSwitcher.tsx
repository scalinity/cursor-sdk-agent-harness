import { useCallback, useMemo, useRef, useState } from "react";
import type { WorkspaceAllowlistRow } from "@harness/shared";
import { cn } from "../../lib/cn.js";
import { useWorkspaceAllowlist } from "../../hooks/useWorkspaceAllowlist.js";
import { useActiveWorkspace } from "../../hooks/useActiveWorkspace.js";
import { useWorkspacePicker, type WorkspacePickError } from "../../hooks/useWorkspacePicker.js";
import { useErrorReporter } from "../../hooks/useErrorReporter.js";
import { useDismiss } from "../../hooks/useDismiss.js";
import { CheckIcon, ChevronDownIcon, FolderIcon, HomeIcon, MonitorIcon } from "./ToolbarIcons.js";

/** Trigger/menu display name: explicit label (e.g. seeded "Home") else basename. */
function displayName(ws: WorkspaceAllowlistRow): string {
  if (ws.label && ws.label.length > 0) return ws.label;
  const segments = ws.path.split("/").filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? ws.path;
}

function isHome(ws: WorkspaceAllowlistRow): boolean {
  return ws.label === "Home";
}

function pickErrorCopy(err: WorkspacePickError): string {
  switch (err.code) {
    case "missing":
      return `That folder doesn't exist: ${err.path}`;
    case "symlink_escape":
      return `That folder symlinks outside its parent: ${err.path}`;
    case "unknown":
      return err.message;
    case "cancelled":
      return "Workspace selection cancelled.";
  }
}

/**
 * WorkspaceSwitcher — the Cursor-style workspace control above the composer.
 * The trigger shows the active workspace name + a chevron and a static "Local"
 * run-target badge; the dropdown lists allowlisted folders (Recents) with the
 * active one checkmarked, plus an "Open Folder…" action that opens the native
 * picker.
 *
 * Effect-free per `harness/no-use-effect-in-components`: open/search are local
 * state, outside-click + Escape dismissal come from `useDismiss`, and the
 * allowlist is refreshed in the open handler (an event, not an effect).
 */
export function WorkspaceSwitcher() {
  const { entries, reload } = useWorkspaceAllowlist();
  const { workspace, activeWorkspaceId, setActive } = useActiveWorkspace();
  const { pick, busy } = useWorkspacePicker();
  const { report } = useErrorReporter("workspace-switcher");

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismiss({ open, onDismiss: close, containerRef });

  const openMenu = () => {
    setQuery("");
    // Refresh the list on open (event, not effect) so a folder added in another
    // surface — this hook keeps entries in local state — shows up here too.
    void reload();
    setOpen(true);
  };

  const filtered = useMemo<WorkspaceAllowlistRow[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => displayName(e).toLowerCase().includes(q) || e.path.toLowerCase().includes(q),
    );
  }, [entries, query]);

  const onSelect = useCallback(
    async (id: string) => {
      try {
        if (id !== activeWorkspaceId) await setActive(id);
        setOpen(false);
      } catch (e) {
        report(e);
      }
    },
    [activeWorkspaceId, setActive, report],
  );

  const onOpenFolder = useCallback(async () => {
    const result = await pick();
    if (result.ok) {
      await reload();
      setOpen(false);
    } else if (result.error.code !== "cancelled") {
      report(pickErrorCopy(result.error), { severity: "warn" });
    }
  }, [pick, reload, report]);

  const triggerName = workspace ? displayName(workspace) : "Select workspace";

  return (
    <div ref={containerRef} className="workspace-switcher">
      <button
        type="button"
        className="ws-switch__trigger"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="menu"
        aria-expanded={open}
        title={workspace ? workspace.path : "Pick a workspace"}
      >
        {workspace && isHome(workspace) ? (
          <HomeIcon className="size-3.5 flex-none opacity-80" />
        ) : (
          <FolderIcon className="size-3.5 flex-none opacity-80" />
        )}
        <span className="truncate">{triggerName}</span>
        <ChevronDownIcon className={cn("size-3 flex-none opacity-60 transition-transform", open && "rotate-180")} />
      </button>

      <span className="ws-switch__target" title="Runs execute locally on this machine">
        <MonitorIcon className="size-3.5" />
        <span>Local</span>
      </span>

      {open ? (
        <div role="menu" className="ws-switch__menu z-50">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workspaces…"
            className="ws-switch__search"
            aria-label="Search workspaces"
          />
          <div className="ws-switch__section">Recents</div>
          <div className="ws-switch__list">
            {filtered.length === 0 ? (
              <div className="ws-switch__empty">No matching workspaces</div>
            ) : (
              filtered.map((e) => {
                const active = e.id === activeWorkspaceId;
                return (
                  <button
                    key={e.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    className={cn("ws-switch__item", active && "ws-switch__item--active")}
                    onClick={() => void onSelect(e.id)}
                    title={e.path}
                  >
                    {isHome(e) ? (
                      <HomeIcon className="size-4 flex-none opacity-80" />
                    ) : (
                      <FolderIcon className="size-4 flex-none opacity-80" />
                    )}
                    <span className="truncate">{isHome(e) ? "Home" : e.path}</span>
                    {active ? <CheckIcon className="ws-switch__check size-3.5 flex-none" /> : null}
                  </button>
                );
              })
            )}
          </div>
          <div className="ws-switch__footer">
            <button
              type="button"
              role="menuitem"
              className="ws-switch__action"
              onClick={() => void onOpenFolder()}
              disabled={busy}
            >
              <FolderIcon className="size-4 flex-none" />
              <span>{busy ? "Opening…" : "Open Folder…"}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
