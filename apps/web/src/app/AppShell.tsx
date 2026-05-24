/**
 * AppShell — the top-level 3-pane layout. Owns no domain state; pulls
 * everything through hooks and stores.
 */
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCsrfToken } from "../hooks/useCsrfToken.js";
import { useAgents } from "../hooks/useAgents.js";
import { useRunHistory } from "../hooks/useRunHistory.js";
import { useSettings } from "../hooks/useSettings.js";
import { useAgentStream } from "../hooks/useAgentStream.js";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts.js";
import { useToastSweeper } from "../hooks/useToastSweeper.js";
import { useActiveWorkspace } from "../hooks/useActiveWorkspace.js";
import { useWorkspacePicker } from "../hooks/useWorkspacePicker.js";
import { useNativeMenuActions } from "../hooks/useNativeMenuActions.js";
import { useEnsureDefaultAgent } from "../hooks/useEnsureDefaultAgent.js";
import { useErrorReporter } from "../hooks/useErrorReporter.js";
import { useUiStore } from "../state/ui-store.js";
import { useRunStore } from "../state/run-store.js";
import { Titlebar } from "../components/shell/Titlebar.js";
import { SessionsRail } from "../components/shell/SessionsRail.js";
import { CenterPane } from "../components/shell/CenterPane.js";
import { RightPane } from "../components/shell/RightPane.js";
import { Statusbar } from "../components/shell/Statusbar.js";
import { BootstrapBanner } from "../components/shell/BootstrapBanner.js";
import { Toaster } from "../components/shell/Toaster.js";
import { NewAgentDialog } from "../components/agents/NewAgentDialog.js";
import { WorkspaceRequiredModal } from "../components/workspace/WorkspaceRequiredModal.js";
import { cn } from "../lib/cn.js";
import type { SdkImage } from "@harness/shared";

export function AppShell() {
  const csrf = useCsrfToken();
  useSettings();
  useToastSweeper();
  const { agents, activeAgent, selectAgent, createAgent } = useAgents();
  const { runs, deleteRun } = useRunHistory();
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const activeRunId = useRunStore((s) => s.activeRunId);
  const setActiveRunId = useRunStore((s) => s.setActiveRunId);
  const activeRunLiveStatus = useRunStore((s) =>
    activeRunId ? (s.byId[activeRunId]?.status ?? null) : null,
  );

  const activeWorkspace = useActiveWorkspace();
  const workspacePicker = useWorkspacePicker();
  const navigate = useNavigate();
  const { report } = useErrorReporter("app-shell");

  const selectedModelId = useUiStore((s) => s.selectedModelId);
  const setComposerDraft = useUiStore((s) => s.setComposerDraft);

  // Auto-provision a universal default "Coding Agent" for the active
  // workspace + selected model so the user never has to create an agent
  // before sending a prompt.
  useEnsureDefaultAgent({
    activeWorkspaceId: activeWorkspace.activeWorkspaceId,
    workspacePath: activeWorkspace.workspace?.path ?? null,
    modelId: selectedModelId,
    agents,
    activeAgent,
    createAgent,
    selectAgent,
  });

  const {
    connectionState,
    submitUserInput,
    cancelRun,
    sendApproval,
    cancelUnavailable,
  } = useAgentStream({
    agentId: activeAgent?.id ?? null,
    runId: activeRunId,
  });
  const onApprovalResolve = useCallback(
    (requestId: string, decision: "approve" | "deny", reason?: string) => {
      if (!activeRunId) return;
      sendApproval(activeRunId, requestId, decision, reason);
    },
    [sendApproval, activeRunId],
  );

  const codeHidden = useUiStore((s) => s.codeHidden);
  const toggleCodeHidden = useUiStore((s) => s.toggleCodeHidden);
  const railHidden = useUiStore((s) => s.railHidden);

  // Only RUNNING/CREATING runs can actually be cancelled. The server drops
  // the active run controller once a run terminates, so a cancel on a
  // finished run replies RUN_NOT_FOUND and looks like a no-op — gate the
  // affordance instead. Overlay the live run-store status over the REST
  // summary so a just-finished run loses the button without a reload.
  const activeRunCancellable = useMemo(() => {
    const summary = runs.find((r) => r.id === activeRunId) ?? null;
    const status = activeRunLiveStatus ?? summary?.status ?? null;
    return status === "RUNNING" || status === "CREATING";
  }, [runs, activeRunId, activeRunLiveStatus]);

  const newSession = useCallback(() => {
    setActiveRunId(null);
    setComposerDraft("");
  }, [setActiveRunId, setComposerDraft]);

  const onDeleteRun = useCallback(
    async (runId: string) => {
      try {
        // Drop the selection first so the center pane doesn't briefly point
        // at a row that's about to vanish from the history reload.
        if (runId === activeRunId) setActiveRunId(null);
        await deleteRun(runId);
      } catch (e) {
        report(e);
      }
    },
    [deleteRun, activeRunId, setActiveRunId, report],
  );

  const onSubmit = useCallback(
    async (input: { prompt: string; agentId: string; images?: SdkImage[] }) => {
      const runId = await submitUserInput(input);
      setActiveRunId(runId);
      return runId;
    },
    [submitUserInput, setActiveRunId],
  );

  const activeRun = useMemo(
    () => runs.find((r) => r.id === activeRunId) ?? null,
    [runs, activeRunId],
  );

  // Native menu actions — Electron only. Browser mode silently ignores.
  useNativeMenuActions({
    "menu:new-agent": () => setNewAgentOpen(true),
    "menu:open-workspace": () => void workspacePicker.pick(),
    "menu:toggle-code-pane": () => toggleCodeHidden(),
    "menu:preferences": () => navigate("/settings/mcp-servers"),
  });

  useKeyboardShortcuts(
    useMemo(
      () => [
        { key: "j", meta: true, handler: () => toggleCodeHidden() },
        { key: "j", ctrl: true, handler: () => toggleCodeHidden() },
        {
          key: "k",
          meta: true,
          allowInEditing: true,
          handler: () => {
            const el = document.querySelector<HTMLInputElement>(
              'input[data-rail-search="true"]',
            );
            el?.focus();
          },
        },
        {
          key: ".",
          meta: true,
          handler: () => {
            if (activeRunId && activeRunCancellable) cancelRun(activeRunId);
          },
        },
      ],
      [toggleCodeHidden, activeRunId, activeRunCancellable, cancelRun],
    ),
  );

  const showBootstrapBanner = csrf.error !== null && csrf.token === null;

  // Phase 16 — block the shell until a workspace is active. Render the modal
  // overlay on top of the (blurred) shell so the user can see context but
  // can't interact until they pick. We avoid showing the modal while the
  // CSRF bootstrap is still pending (otherwise the picker's POSTs would 403
  // before the token arrives).
  const showWorkspaceModal =
    csrf.token !== null &&
    !activeWorkspace.loading &&
    activeWorkspace.activeWorkspaceId === null;

  return (
    <>
      <div
        className={cn(
          "app-grid",
          codeHidden && "app-grid--code-hidden",
          railHidden && "app-grid--rail-hidden",
          // The modal is rendered as a sibling, not a child, so `blur-sm`
          // (a CSS filter that inherits) and `pointer-events-none` (which
          // cascades) only affect the shell — never the modal itself.
          showWorkspaceModal && "pointer-events-none select-none blur-sm",
        )}
      >
        {showBootstrapBanner ? (
          <BootstrapBanner
            error={csrf.error ?? "CSRF bootstrap failed"}
            loading={csrf.loading}
            onRetry={() => void csrf.refresh()}
          />
        ) : null}
        <Titlebar
          onNewAgent={() => setNewAgentOpen(true)}
          {...(activeRunId
            ? { onCancelRun: () => cancelRun(activeRunId) }
            : {})}
        />
        <SessionsRail
          runs={runs}
          activeRunId={activeRunId}
          onSelectRun={setActiveRunId}
          onNewAgent={() => setNewAgentOpen(true)}
          onPickWorkspace={() => void workspacePicker.pick()}
          onNewSession={newSession}
          onDeleteRun={onDeleteRun}
        />
        <CenterPane
          activeAgent={activeAgent}
          activeRun={activeRun}
          activeRunId={activeRunId}
          connectionState={connectionState}
          onSubmit={onSubmit}
          onApprovalResolve={onApprovalResolve}
          cancelUnavailable={cancelUnavailable}
        />
        <RightPane activeRunId={activeRunId} />
        <Statusbar
          connectionState={connectionState}
          modelLabel={activeAgent?.modelId ?? null}
          runningRunId={activeRunId}
          workspaceName={activeWorkspace.workspace?.label ?? activeWorkspace.workspace?.path ?? null}
        />
        <NewAgentDialog
          open={newAgentOpen}
          onClose={() => setNewAgentOpen(false)}
          onCreated={(agentId) => selectAgent(agentId)}
        />
      </div>
      {showWorkspaceModal ? <WorkspaceRequiredModal /> : null}
      <Toaster />
    </>
  );
}
