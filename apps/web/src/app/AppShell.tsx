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
import { useUiStore } from "../state/ui-store.js";
import { useRunStore } from "../state/run-store.js";
import { Titlebar } from "../components/shell/Titlebar.js";
import { SessionsRail } from "../components/shell/SessionsRail.js";
import { CenterPane } from "../components/shell/CenterPane.js";
import { RightPane } from "../components/shell/RightPane.js";
import { Statusbar } from "../components/shell/Statusbar.js";
import { BootstrapBanner } from "../components/shell/BootstrapBanner.js";
import { NewAgentDialog } from "../components/agents/NewAgentDialog.js";
import { WorkspaceRequiredModal } from "../components/workspace/WorkspaceRequiredModal.js";
import { cn } from "../lib/cn.js";

export function AppShell() {
  const csrf = useCsrfToken();
  useSettings();
  useToastSweeper();
  const { activeAgent, selectAgent } = useAgents();
  const { runs } = useRunHistory();
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const activeRunId = useRunStore((s) => s.activeRunId);
  const setActiveRunId = useRunStore((s) => s.setActiveRunId);

  const activeWorkspace = useActiveWorkspace();
  const workspacePicker = useWorkspacePicker();
  const navigate = useNavigate();

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
            if (activeRunId) cancelRun(activeRunId);
          },
        },
      ],
      [toggleCodeHidden, activeRunId, cancelRun],
    ),
  );

  const onSubmit = useCallback(
    async (input: { prompt: string; agentId: string }) => {
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
    <div
      className={cn(
        "app-grid",
        codeHidden && "app-grid--code-hidden",
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
        workspace={activeWorkspace.workspace}
        onPickWorkspace={() => void workspacePicker.pick()}
        {...(activeRunId
          ? { onCancelRun: () => cancelRun(activeRunId) }
          : {})}
      />
      <SessionsRail runs={runs} activeRunId={activeRunId} onSelectRun={setActiveRunId} />
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
      {showWorkspaceModal ? <WorkspaceRequiredModal /> : null}
    </div>
  );
}
