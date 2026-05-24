import type { ComponentType } from "react";
import { codeEditEventsForRun, parseCodeEditPayload, selectedCodeEditEvent } from "../../lib/code-edit-events.js";
import { useRunStore } from "../../state/run-store.js";
import type { CanonicalRunEvent } from "../../state/run-store.js";
import { useUiStore, type RightPanelTab } from "../../state/ui-store.js";
import { CodeEditPreviewPanel } from "../streaming/CodeEditPreviewPanel.js";
import { RightPaneTabs } from "./RightTabs.js";
import { Breadcrumbs } from "./Breadcrumbs.js";
import { FilesIcon, TerminalIcon, type IconProps } from "./ToolbarIcons.js";
import { BrowserPane } from "../browser/BrowserPane.js";

export interface RightPaneProps {
  activeRunId: string | null;
}

// F-001: stable empty-array reference. Returning `[]` from the selector
// each render would change reference identity every call, which causes
// Zustand's `useSyncExternalStore` to flag a snapshot change and loop.
const EMPTY_EVENTS: CanonicalRunEvent[] = [];

export function RightPane({ activeRunId }: RightPaneProps) {
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  return (
    <section className="right-pane">
      <RightPaneTabs />
      {rightPanelTab === "diff" ? (
        <DiffSurface activeRunId={activeRunId} />
      ) : rightPanelTab === "browser" ? (
        <BrowserPane activeRunId={activeRunId} />
      ) : (
        <PlaceholderSurface tab={rightPanelTab} />
      )}
    </section>
  );
}

function DiffSurface({ activeRunId }: RightPaneProps) {
  const events = useRunStore((s) => (activeRunId ? (s.eventsByRunId[activeRunId]?.events ?? EMPTY_EVENTS) : EMPTY_EVENTS));
  const selectedEventId = useUiStore((s) => (activeRunId ? (s.selectedCodeEditEventByRunId[activeRunId] ?? null) : null));
  const editEvents = codeEditEventsForRun(events);
  const activeEvent = selectedCodeEditEvent(events, selectedEventId);
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

const PLACEHOLDERS: Record<
  Exclude<RightPanelTab, "diff" | "browser">,
  { title: string; body: string; Icon: ComponentType<IconProps> }
> = {
  files: {
    title: "Files",
    body: "A workspace file browser isn't wired up yet. Agent file edits appear under Diff.",
    Icon: FilesIcon,
  },
  terminal: {
    title: "Terminal",
    body: "An embedded terminal isn't available yet. Agent shell tool calls stream into the chat timeline.",
    Icon: TerminalIcon,
  },
};

function PlaceholderSurface({ tab }: { tab: Exclude<RightPanelTab, "diff" | "browser"> }) {
  const { title, body, Icon } = PLACEHOLDERS[tab];
  return (
    <div className="right-pane__placeholder">
      <Icon className="size-7" />
      <div className="right-pane__placeholder-title">{title}</div>
      <p className="right-pane__placeholder-body">{body}</p>
    </div>
  );
}
