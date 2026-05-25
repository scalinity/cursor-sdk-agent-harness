import { useMemo, useRef, useState } from "react";
import type { RunSummary, SdkRunStatus, WorkspaceAllowlistRow } from "@harness/shared";
import { cn } from "../../lib/cn.js";
import { useRunStore } from "../../state/run-store.js";
import { useWorkspaceAllowlist } from "../../hooks/useWorkspaceAllowlist.js";
import { useActiveWorkspace } from "../../hooks/useActiveWorkspace.js";
import { ChevronDownIcon, FolderIcon, PlusIcon, XIcon } from "./ToolbarIcons.js";
import { httpRequest, mutatingRequest } from "../../lib/http-client.js";
import { useUiStore } from "../../state/ui-store.js";
import { csrfTokenResponseSchema } from "@harness/shared";

/**
 * SessionsRail — left rail. Top action starts a new chat (a fresh session);
 * below, chats are grouped under the workspace that was active when each run
 * started (`run.workspaceId`). Runs with no/unknown workspace fall into
 * "Unassigned". Clicking a workspace header makes it the active workspace.
 */
export interface SessionsRailProps {
  runs: RunSummary[];
  activeRunId: string | null;
  onSelectRun: (runId: string) => void;
  onPickWorkspace?: () => void;
  /** Start a fresh session (clears the active run so the composer resets). */
  onNewSession?: () => void;
  /** Delete a terminal conversation from the rail. */
  onDeleteRun?: (runId: string) => void;
  /** Called after a successful rename so the parent can reload the run list. */
  onRenameRun?: (runId: string, name: string) => void;
}

function dotClass(status: SdkRunStatus): string {
  if (status === "RUNNING" || status === "CREATING") return "rail-item__dot--run";
  if (status === "FINISHED") return "rail-item__dot--ok";
  if (status === "ERROR" || status === "CANCELLED" || status === "EXPIRED")
    return "rail-item__dot--err";
  return "";
}

/** A run is terminal (deletable) once it's no longer in-flight. */
function isTerminal(status: SdkRunStatus): boolean {
  return status !== "RUNNING" && status !== "CREATING";
}

function workspaceLabel(ws: WorkspaceAllowlistRow): string {
  if (ws.label && ws.label.length > 0) return ws.label;
  const segments = ws.path.split("/").filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? ws.path;
}

export function SessionsRail({
  runs,
  activeRunId,
  onSelectRun,
  onPickWorkspace,
  onNewSession,
  onDeleteRun,
  onRenameRun,
}: SessionsRailProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  // Workspaces explicitly collapsed by the user. Default is expanded, so a
  // freshly-loaded rail shows every workspace's chats without a click.
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());

  const { entries } = useWorkspaceAllowlist();
  const { activeWorkspaceId, setActive } = useActiveWorkspace();

  // Overlay live run-store status over the REST RunSummary so an in-flight
  // status update surfaces without waiting for the next REST reload (RV2-S11).
  const runStoreById = useRunStore((s) => s.byId);
  const effectiveRuns = useMemo<RunSummary[]>(
    () =>
      runs.map((r) => {
        const live = runStoreById[r.id];
        return live?.status ? { ...r, status: live.status } : r;
      }),
    [runs, runStoreById],
  );

  const filteredRuns = useMemo<RunSummary[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return effectiveRuns;
    return effectiveRuns.filter((r) =>
      (r.promptPreview || r.id).toLowerCase().includes(q),
    );
  }, [effectiveRuns, query]);

  const { byWorkspace, unassigned } = useMemo(() => {
    const known = new Set(entries.map((e) => e.id));
    const map = new Map<string, RunSummary[]>();
    const orphans: RunSummary[] = [];
    for (const r of filteredRuns) {
      if (r.workspaceId && known.has(r.workspaceId)) {
        const list = map.get(r.workspaceId);
        if (list) list.push(r);
        else map.set(r.workspaceId, [r]);
      } else {
        orphans.push(r);
      }
    }
    return { byWorkspace: map, unassigned: orphans };
  }, [filteredRuns, entries]);

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside className="sessions-rail">
      <div className="rail-top">
        <button
          type="button"
          className="rail-new-agent"
          onClick={() => onNewSession?.()}
          aria-label="New session"
          title="New chat"
        >
          <PlusIcon className="size-4" />
          <span>New Chat</span>
        </button>
      </div>

      <div className="mx-2.5 mb-2 flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-1 px-2 py-1 text-md text-text-tertiary">
        <input
          ref={searchRef}
          data-rail-search="true"
          placeholder="Search chats…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-transparent text-text-primary placeholder:text-text-tertiary outline-none"
        />
        <span className="mono text-2xs">⌘K</span>
      </div>

      <div className="rail-scroll">
        <div className="rail-section-head">
          <span>Workspaces</span>
        </div>

        {entries.length === 0 ? (
          <div className="px-3.5 py-1 text-md text-text-tertiary">
            No workspaces yet.
          </div>
        ) : (
          entries.map((ws) => (
            <WorkspaceGroup
              key={ws.id}
              workspace={ws}
              isActive={ws.id === activeWorkspaceId}
              collapsed={collapsedIds.has(ws.id)}
              runs={byWorkspace.get(ws.id) ?? []}
              activeRunId={activeRunId}
              onSelectRun={onSelectRun}
              onToggle={() => toggleCollapsed(ws.id)}
              onActivate={() => void setActive(ws.id)}
              {...(onDeleteRun ? { onDeleteRun } : {})}
              {...(onRenameRun ? { onRenameRun } : {})}
            />
          ))
        )}

        {unassigned.length > 0 ? (
          <UnassignedGroup
            collapsed={collapsedIds.has("__unassigned__")}
            runs={unassigned}
            activeRunId={activeRunId}
            onSelectRun={onSelectRun}
            onToggle={() => toggleCollapsed("__unassigned__")}
            {...(onDeleteRun ? { onDeleteRun } : {})}
            {...(onRenameRun ? { onRenameRun } : {})}
          />
        ) : null}

        <button
          type="button"
          className="rail-open-workspace"
          onClick={onPickWorkspace}
          disabled={!onPickWorkspace}
        >
          <FolderIcon className="size-4" />
          <span>Open Workspace…</span>
        </button>

        {runs.length === 0 ? (
          <div className="px-3.5 pt-2 text-md text-text-tertiary">
            No chats yet. Start one from the composer.
          </div>
        ) : null}
      </div>

      <div className="mt-auto border-t border-border-subtle p-2.5">
        <div className="flex items-center gap-2 p-1">
          <div className="grid size-6 place-items-center rounded-full bg-accent-bg text-2xs font-semibold text-accent-primary">
            HA
          </div>
          <div className="min-w-0">
            <div className="truncate text-md">Harness</div>
            <div className="text-2xs text-text-tertiary">local · single-user</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

interface WorkspaceGroupProps {
  workspace: WorkspaceAllowlistRow;
  isActive: boolean;
  collapsed: boolean;
  runs: RunSummary[];
  activeRunId: string | null;
  onSelectRun: (runId: string) => void;
  onToggle: () => void;
  onActivate: () => void;
  onDeleteRun?: (runId: string) => void;
  onRenameRun?: (runId: string, name: string) => void;
}

function WorkspaceGroup({
  workspace,
  isActive,
  collapsed,
  runs,
  activeRunId,
  onSelectRun,
  onToggle,
  onActivate,
  onDeleteRun,
  onRenameRun,
}: WorkspaceGroupProps) {
  return (
    <div className="ws-group">
      <div className={cn("ws-head", isActive && "ws-head--active")}>
        <button
          type="button"
          className="ws-head__twisty"
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <ChevronDownIcon className={cn("size-3.5 ws-twisty", collapsed && "ws-twisty--collapsed")} />
        </button>
        <button
          type="button"
          className="ws-head__label"
          onClick={onActivate}
          title={`${workspace.path} (click to make active)`}
        >
          <FolderIcon className="size-4 flex-none" />
          <span className="truncate">{workspaceLabel(workspace)}</span>
          {isActive ? <span className="ws-head__active-dot" aria-hidden="true" /> : null}
        </button>
      </div>
      {!collapsed ? (
        <div className="ws-children">
          {runs.length === 0 ? (
            <div className="ws-empty">No chats</div>
          ) : (
            runs.map((run) => (
              <RailItem
                key={run.id}
                run={run}
                isActive={run.id === activeRunId}
                onSelectRun={onSelectRun}
                {...(onDeleteRun ? { onDeleteRun } : {})}
                {...(onRenameRun ? { onRenameRun } : {})}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

interface UnassignedGroupProps {
  collapsed: boolean;
  runs: RunSummary[];
  activeRunId: string | null;
  onSelectRun: (runId: string) => void;
  onToggle: () => void;
  onDeleteRun?: (runId: string) => void;
  onRenameRun?: (runId: string, name: string) => void;
}

function UnassignedGroup({
  collapsed,
  runs,
  activeRunId,
  onSelectRun,
  onToggle,
  onDeleteRun,
  onRenameRun,
}: UnassignedGroupProps) {
  return (
    <div className="ws-group">
      <div className="ws-head">
        <button
          type="button"
          className="ws-head__twisty"
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <ChevronDownIcon className={cn("size-3.5 ws-twisty", collapsed && "ws-twisty--collapsed")} />
        </button>
        <span className="ws-head__label ws-head__label--static">
          <span className="truncate text-text-tertiary">Unassigned</span>
        </span>
      </div>
      {!collapsed ? (
        <div className="ws-children">
          {runs.map((run) => (
            <RailItem
              key={run.id}
              run={run}
              isActive={run.id === activeRunId}
              onSelectRun={onSelectRun}
              {...(onDeleteRun ? { onDeleteRun } : {})}
              {...(onRenameRun ? { onRenameRun } : {})}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface RailItemProps {
  run: RunSummary;
  isActive: boolean;
  onSelectRun: (runId: string) => void;
  onDeleteRun?: (runId: string) => void;
  onRenameRun?: (runId: string, name: string) => void;
}

function RailItem({ run, isActive, onSelectRun, onDeleteRun, onRenameRun }: RailItemProps) {
  // Deleting a run cascade-deletes all its events (FK ON DELETE CASCADE) and
  // is irreversible, so require a confirming second click. Disarms when the
  // pointer leaves the row or the button loses focus — no timer, so the
  // component stays effect-free per the repo rule.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const label = run.name ?? run.promptPreview ?? run.id;

  const startRename = () => {
    setRenameValue(label);
    setRenaming(true);
    // Focus happens after the next paint when the input renders.
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  };

  const commitRename = () => {
    const trimmed = renameValue.trim();
    setRenaming(false);
    if (trimmed.length === 0 || trimmed === label) return;
    void mutatingRequest(`/api/runs/${run.id}`, {
      method: "PATCH",
      body: { name: trimmed },
      getCsrfToken: () => useUiStore.getState().csrfToken,
      refreshCsrfToken: async () => {
        try {
          const res = await httpRequest("/api/security/csrf-token", {
            responseSchema: csrfTokenResponseSchema,
          });
          useUiStore.getState().setCsrfToken(res.token);
          return res.token;
        } catch {
          return null;
        }
      },
    }).then(() => {
      onRenameRun?.(run.id, trimmed);
    });
  };

  const cancelRename = () => {
    setRenaming(false);
  };

  return (
    <div
      className={cn("rail-item rail-item--nested", isActive && "rail-item--active")}
      onClick={() => onSelectRun(run.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelectRun(run.id);
      }}
      onMouseLeave={() => setConfirmingDelete(false)}
    >
      <span className={cn("rail-item__dot", dotClass(run.status))} aria-hidden="true" />
      <div className="min-w-0">
        {renaming ? (
          <input
            ref={renameInputRef}
            className="w-full bg-transparent text-md text-text-primary outline-none"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") cancelRename();
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="rail-item__title"
            onDoubleClick={(e) => {
              e.stopPropagation();
              startRename();
            }}
          >
            {label}
          </div>
        )}
        <div className="rail-item__meta">
          {run.status.toLowerCase()} · {new Date(run.startedAt).toLocaleTimeString()}
        </div>
      </div>
      {onDeleteRun && isTerminal(run.status) ? (
        <button
          type="button"
          className={cn("rail-item__delete", confirmingDelete && "rail-item__delete--armed")}
          aria-label={confirmingDelete ? "Click again to confirm delete" : "Delete conversation"}
          title={confirmingDelete ? "Click again to confirm delete" : "Delete conversation"}
          onClick={(e) => {
            e.stopPropagation();
            if (confirmingDelete) {
              setConfirmingDelete(false);
              onDeleteRun(run.id);
            } else {
              setConfirmingDelete(true);
            }
          }}
          onKeyDown={(e) => e.stopPropagation()}
          onBlur={() => setConfirmingDelete(false)}
        >
          <XIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
