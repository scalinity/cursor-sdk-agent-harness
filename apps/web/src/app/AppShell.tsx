/**
 * AppShell — the top-level 3-pane layout. Owns no domain state; pulls
 * everything through hooks and stores. The shell mounts:
 *   - CSRF bootstrap   (useCsrfToken)
 *   - Agents + runs    (useAgents, useRunHistory)
 *   - Settings         (useSettings) — drives statusbar model label
 *   - WS connection    (useAgentStream)
 *   - ⌘J / ⌘K bindings (useKeyboardShortcuts)
 */
import { useCallback, useMemo } from "react";
import { useCsrfToken } from "../hooks/useCsrfToken.js";
import { useAgents } from "../hooks/useAgents.js";
import { useRunHistory } from "../hooks/useRunHistory.js";
import { useSettings } from "../hooks/useSettings.js";
import { useAgentStream } from "../hooks/useAgentStream.js";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts.js";
import { useToastSweeper } from "../hooks/useToastSweeper.js";
import { useUiStore } from "../state/ui-store.js";
import { useRunStore } from "../state/run-store.js";
import { Titlebar } from "../components/shell/Titlebar.js";
import { SessionsRail } from "../components/shell/SessionsRail.js";
import { CenterPane } from "../components/shell/CenterPane.js";
import { RightPane } from "../components/shell/RightPane.js";
import { Statusbar } from "../components/shell/Statusbar.js";
import { BootstrapBanner } from "../components/shell/BootstrapBanner.js";
import { cn } from "../lib/cn.js";

export function AppShell() {
  const csrf = useCsrfToken(); // bootstrap CSRF into ui-store.
  useSettings(); // hydrate settings on mount.
  useToastSweeper(); // dismiss expired toasts automatically (RV2-S8).
  const { activeAgent } = useAgents();
  const { runs } = useRunHistory();
  const activeRunId = useRunStore((s) => s.activeRunId);
  const setActiveRunId = useRunStore((s) => s.setActiveRunId);

  const { connectionState, submitUserInput, cancelRun } = useAgentStream({
    agentId: activeAgent?.id ?? null,
    runId: activeRunId,
  });

  const codeHidden = useUiStore((s) => s.codeHidden);
  const toggleCodeHidden = useUiStore((s) => s.toggleCodeHidden);

  useKeyboardShortcuts(
    useMemo(
      () => [
        {
          key: "j",
          meta: true,
          handler: () => toggleCodeHidden(),
        },
        {
          key: "j",
          ctrl: true,
          handler: () => toggleCodeHidden(),
        },
        {
          // ⌘K must still focus the rail search even when an editable
          // element is focused (the user invokes it from anywhere, including
          // inside the Composer textarea).
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
      // submitUserInput already set activeRunId; mirror here defensively.
      setActiveRunId(runId);
      return runId;
    },
    [submitUserInput, setActiveRunId],
  );

  const activeRun = useMemo(
    () => runs.find((r) => r.id === activeRunId) ?? null,
    [runs, activeRunId],
  );

  // Bootstrap failure banner: shown when the CSRF fetch errored AND we have
  // no token. Mutating REST calls and the WS upgrade both require a token,
  // so the shell is functionally unusable in this state — surface a banner
  // with a manual retry instead of leaving the user looking at an empty UI.
  const showBootstrapBanner = csrf.error !== null && csrf.token === null;

  return (
    <div className={cn("app-grid", codeHidden && "app-grid--code-hidden")}>
      {showBootstrapBanner ? (
        <BootstrapBanner
          error={csrf.error ?? "CSRF bootstrap failed"}
          loading={csrf.loading}
          onRetry={() => void csrf.refresh()}
        />
      ) : null}
      <Titlebar />
      <SessionsRail runs={runs} activeRunId={activeRunId} onSelectRun={setActiveRunId} />
      <CenterPane
        activeAgent={activeAgent}
        activeRun={activeRun}
        activeRunId={activeRunId}
        connectionState={connectionState}
        onSubmit={onSubmit}
      />
      <RightPane activeRunId={activeRunId} />
      <Statusbar
        connectionState={connectionState}
        modelLabel={activeAgent?.modelId ?? null}
        runningRunId={activeRunId}
      />
    </div>
  );
}
