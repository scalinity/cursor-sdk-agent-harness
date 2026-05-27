import { useRef } from "react";
import { parseCodeEditPayload, selectedCodeEditEvent } from "../../lib/code-edit-events.js";
import { cn } from "../../lib/cn.js";
import { useRunStore, type CanonicalRunEvent } from "../../state/run-store.js";
import { useUiStore } from "../../state/ui-store.js";
import { CodeEditPreviewPanel } from "../streaming/CodeEditPreviewPanel.js";
import { RightPaneTabs } from "./RightTabs.js";
import { Breadcrumbs } from "./Breadcrumbs.js";
import { TerminalSurface } from "./TerminalSurface.js";
import { BrowserPane } from "../browser/BrowserPane.js";
import { SearchPanel } from "../SearchPanel.js";
import { FilesPanel } from "../FilesPanel.js";

export interface RightPaneProps {
  activeRunId: string | null;
}

// F-001: stable empty-array reference. Returning `[]` from the selector
// each render would change reference identity every call, which causes
// Zustand's `useSyncExternalStore` to flag a snapshot change and loop.
const EMPTY_EVENTS: CanonicalRunEvent[] = [];

export function RightPane({ activeRunId }: RightPaneProps) {
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  // The Files surface is keyed by the active workspace id so it remounts and
  // resets to the new workspace root when the user switches workspaces
  // (CLAUDE.md "reset with key" pattern — no reactive effect needed).
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId);
  // Latch: keep the terminal mounted once it has been opened so its PTY
  // session and scrollback survive a tab switch (the server holds the shell;
  // the client socket + xterm stay alive). Mutating a ref during render is a
  // safe, idempotent memo here — no effect required.
  const terminalOpenedRef = useRef(false);
  if (rightPanelTab === "terminal") terminalOpenedRef.current = true;

  return (
    <section className="right-pane">
      <RightPaneTabs />
      {rightPanelTab === "diff" ? <DiffSurface activeRunId={activeRunId} /> : null}
      {rightPanelTab === "files" ? <FilesPanel key={activeWorkspaceId ?? "none"} /> : null}
      {rightPanelTab === "browser" ? <BrowserPane activeRunId={activeRunId} /> : null}
      {rightPanelTab === "search" ? <SearchPanel /> : null}
      {terminalOpenedRef.current ? (
        <div
          className={cn("terminal-mount", rightPanelTab !== "terminal" && "terminal-mount--hidden")}
        >
          <TerminalSurface />
        </div>
      ) : null}
    </section>
  );
}

function DiffSurface({ activeRunId }: RightPaneProps) {
  const editEvents = useRunStore((s) => (activeRunId ? (s.eventsByRunId[activeRunId]?.codeEditEvents ?? EMPTY_EVENTS) : EMPTY_EVENTS));
  const selectedEventId = useUiStore((s) => (activeRunId ? (s.selectedCodeEditEventByRunId[activeRunId] ?? null) : null));
  const activeEvent = selectedCodeEditEvent(editEvents, selectedEventId);
  const payload = activeEvent ? parseCodeEditPayload(activeEvent.payload) : null;
  const activePath = payload?.edits[0]?.path ?? null;
  const segments = activePath ? activePath.split("/") : [];

  return (
    <>
      {segments.length > 0 ? (
        <Breadcrumbs
          segments={segments}
          banner={editEvents.length > 0 ? "agent edit preview" : null}
        />
      ) : null}
      <div className="editor-area editor-area--preview">
        <CodeEditPreviewPanel runId={activeRunId} />
      </div>
    </>
  );
}
