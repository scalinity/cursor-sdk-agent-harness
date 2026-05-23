import { codeEditEventsForRun, parseCodeEditPayload, selectedCodeEditEvent } from "../../lib/code-edit-events.js";
import { useRunStore } from "../../state/run-store.js";
import type { CanonicalRunEvent } from "../../state/run-store.js";
import { useUiStore } from "../../state/ui-store.js";
import { CodeEditPreviewPanel } from "../streaming/CodeEditPreviewPanel.js";
import { RightTabs, type RightTab } from "./RightTabs.js";
import { Breadcrumbs } from "./Breadcrumbs.js";

export interface RightPaneProps {
  activeRunId: string | null;
}

// F-001: stable empty-array reference. Returning `[]` from the selector
// each render would change reference identity every call, which causes
// Zustand's `useSyncExternalStore` to flag a snapshot change and loop.
const EMPTY_EVENTS: CanonicalRunEvent[] = [];

export function RightPane({ activeRunId }: RightPaneProps) {
  const events = useRunStore((s) => (activeRunId ? (s.eventsByRunId[activeRunId]?.events ?? EMPTY_EVENTS) : EMPTY_EVENTS));
  const selectedEventId = useUiStore((s) => (activeRunId ? (s.selectedCodeEditEventByRunId[activeRunId] ?? null) : null));
  const editEvents = codeEditEventsForRun(events);
  const activeEvent = selectedCodeEditEvent(events, selectedEventId);
  const payload = activeEvent ? parseCodeEditPayload(activeEvent.payload) : null;
  const activePath = payload?.edits[0]?.path ?? null;

  const tabs: RightTab[] = activeEvent && activePath
    ? [
        {
          id: activeEvent.event_id,
          label: activePath,
          active: true,
          agentEditing: editEvents.length > 0,
        },
      ]
    : [];

  const segments = activePath ? activePath.split("/") : [];

  return (
    <section className="right-pane">
      <RightTabs tabs={tabs} />
      {segments.length > 0 ? (
        <Breadcrumbs
          segments={segments}
          banner={editEvents.length > 0 ? "agent edit preview" : null}
        />
      ) : null}
      <div className="editor-area editor-area--preview">
        <CodeEditPreviewPanel runId={activeRunId} />
      </div>
    </section>
  );
}
