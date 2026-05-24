import type { BrowserState } from "@harness/shared";

/**
 * Bottom strip: current URL, last action, and a live loading marker. The
 * console-error badge + screenshot count land with the console drawer in the
 * MCP milestone.
 */
export function BrowserStatusStrip({ state }: { state: BrowserState }) {
  return (
    <div className="browser-statusstrip">
      <span className="browser-statusstrip__url">{state.url || "no page loaded"}</span>
      <span className="browser-statusstrip__spacer" />
      {state.lastAction ? (
        <span className="browser-statusstrip__action">{state.lastAction}</span>
      ) : null}
      {state.loading ? <span className="browser-statusstrip__loading">loading…</span> : null}
    </div>
  );
}
