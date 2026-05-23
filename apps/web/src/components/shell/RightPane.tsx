import { codeEditEventsForRun, parseCodeEditPayload, selectedCodeEditEvent } from "../../lib/code-edit-events.js";
import { useRunStore } from "../../state/run-store.js";
import { useUiStore } from "../../state/ui-store.js";
import { CodeEditPreviewPanel } from "../streaming/CodeEditPreviewPanel.js";
import { RightTabs } from "./RightTabs.js";
import { Breadcrumbs } from "./Breadcrumbs.js";

export interface RightPaneProps {
  activeRunId: string | null;
}

export function RightPane({ activeRunId }: RightPaneProps) {
  const events = useRunStore((s) => (activeRunId ? (s.eventsByRunId[activeRunId]?.events ?? []) : []));
  const selectedEventId = useUiStore((s) => (activeRunId ? (s.selectedCodeEditEventByRunId[activeRunId] ?? null) : null));
  const editEvents = codeEditEventsForRun(events);
  const activeEvent = selectedCodeEditEvent(events, selectedEventId);
  const payload = activeEvent ? parseCodeEditPayload(activeEvent.payload) : null;
  const activePath = payload?.edits[0]?.path ?? "no-file-open";
  const segments = activePath === "no-file-open" ? ["harness", "preview", activePath] : activePath.split("/");

  return (
    <section className="right-pane">
      <RightTabs
        tabs={[
          {
            id: activeEvent?.event_id ?? "placeholder",
            label: activePath,
            active: true,
            agentEditing: editEvents.length > 0,
          },
        ]}
      />
      <Breadcrumbs segments={segments} banner={editEvents.length > 0 ? "agent edit preview" : null} />
      <div className="editor-area editor-area--preview">
        <CodeEditPreviewPanel runId={activeRunId} />
      </div>
    </section>
  );
}
