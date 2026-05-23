/**
 * EditorPlaceholder — Phase 10 lands the real `CodeEditPreview`. Until then
 * this renders a static "no file open" surface inside the right pane.
 */
export function EditorPlaceholder() {
  return (
    <div className="editor-area">
      <div className="mono text-md text-text-tertiary">
        {"// Editor preview ships in Phase 10 (CodeEditPreview)."}
      </div>
      <div className="mono mt-2 text-md text-text-tertiary">
        {"// For now, the right pane shows this placeholder."}
      </div>
      <div className="mono mt-2 text-md text-text-tertiary">
        {"// The agent-mark dot on the tabs above lights up when a tool call"}
      </div>
      <div className="mono text-md text-text-tertiary">
        {"// emits a code_edit.detected canonical event."}
      </div>
    </div>
  );
}
