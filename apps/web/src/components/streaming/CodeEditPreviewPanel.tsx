import type { ReplaySpeed } from "@harness/shared";
import { parseCodeEditPayload, selectedCodeEditEvent } from "../../lib/code-edit-events.js";
import { cn } from "../../lib/cn.js";
import { useRunStore, type CanonicalRunEvent } from "../../state/run-store.js";
import { useUiStore } from "../../state/ui-store.js";
import { CodeEditPreview } from "./CodeEditPreview.js";

export interface CodeEditPreviewPanelProps {
  runId: string | null;
  compact?: boolean | undefined;
}

const SPEEDS: ReplaySpeed[] = ["1x", "2x", "4x", "instant"];
const EMPTY_EVENTS: CanonicalRunEvent[] = [];

export function CodeEditPreviewPanel({ runId, compact }: CodeEditPreviewPanelProps) {
  const editEvents = useRunStore((s) => (runId ? (s.eventsByRunId[runId]?.codeEditEvents ?? EMPTY_EVENTS) : EMPTY_EVENTS));
  const selectedEventId = useUiStore((s) => (runId ? (s.selectedCodeEditEventByRunId[runId] ?? null) : null));
  const selectCodeEditEvent = useUiStore((s) => s.selectCodeEditEvent);
  const replaySpeed = useUiStore((s) => (runId ? (s.replaySpeedByRunId[runId] ?? "1x") : "1x"));
  const replayPaused = useUiStore((s) => (runId ? (s.replayPausedByRunId[runId] ?? false) : false));
  const setReplaySpeed = useUiStore((s) => s.setReplaySpeed);
  const setReplayPaused = useUiStore((s) => s.setReplayPaused);

  const activeEvent = selectedCodeEditEvent(editEvents, selectedEventId);
  const activePayload = activeEvent ? parseCodeEditPayload(activeEvent.payload) : null;
  const activeIndex = activeEvent ? editEvents.findIndex((event) => event.event_id === activeEvent.event_id) : -1;

  if (!runId) {
    return <div className="editor-area code-edit-empty">Select a run to preview edits.</div>;
  }
  if (!activeEvent || !activePayload) {
    return <div className="editor-area code-edit-empty">No code edits detected for this run.</div>;
  }

  const title = activePayload.edits[0]?.path ?? "code edit";
  const canGoBack = activeIndex > 0;
  const canGoForward = activeIndex >= 0 && activeIndex < editEvents.length - 1;

  return (
    <section className={cn("code-edit-panel", compact && "code-edit-panel--compact")}>
      <header className="code-edit-panel__toolbar">
        <div className="code-edit-panel__title">
          <span className="mono">{title}</span>
          <span>{activePayload.confidence}</span>
        </div>
        {!compact ? (
          <div className="code-edit-panel__nav" aria-label="Code edit navigation">
            <button
              type="button"
              disabled={!canGoBack}
              onClick={() => {
                const previous = editEvents[activeIndex - 1];
                if (previous) selectCodeEditEvent(runId, previous.event_id);
              }}
            >
              prev
            </button>
            <span className="mono">
              {(activeIndex + 1).toString()} / {editEvents.length.toString()}
            </span>
            <button
              type="button"
              disabled={!canGoForward}
              onClick={() => {
                const next = editEvents[activeIndex + 1];
                if (next) selectCodeEditEvent(runId, next.event_id);
              }}
            >
              next
            </button>
          </div>
        ) : null}
        <div className="code-edit-panel__speed" aria-label="Replay speed">
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              className={speed === replaySpeed ? "is-active" : undefined}
              onClick={() => setReplaySpeed(runId, speed)}
            >
              {speed}
            </button>
          ))}
          <button type="button" onClick={() => setReplayPaused(runId, !replayPaused)}>
            {replayPaused ? "resume" : "pause"}
          </button>
        </div>
      </header>
      <CodeEditPreview runId={runId} eventId={activeEvent.event_id} compact={compact} />
    </section>
  );
}