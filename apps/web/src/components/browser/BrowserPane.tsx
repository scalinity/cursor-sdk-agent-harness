import { useRunStore } from "../../state/run-store.js";
import { useUiStore } from "../../state/ui-store.js";
import { useBrowser } from "../../hooks/useBrowser.js";
import { GlobeIcon } from "../shell/ToolbarIcons.js";
import { BrowserUrlBar } from "./BrowserUrlBar.js";
import { BrowserViewPlaceholder } from "./BrowserViewPlaceholder.js";
import { BrowserStatusStrip } from "./BrowserStatusStrip.js";

export interface BrowserPaneProps {
  activeRunId: string | null;
}

/**
 * Standalone browser session id used when no agent is active, so the Browser
 * tab works like a normal browser without requiring an agent first. When an
 * agent IS active, the pane uses that agent's id, keeping agent-driven sessions
 * isolated per agent (spec §10).
 */
const MANUAL_BROWSER_ID = "manual";

/**
 * Right-pane "Browser" surface — a fully usable browser. It binds to the active
 * run's agent when there is one (so agent-driven browsing shows here and each
 * agent's session stays isolated), and otherwise falls back to a standalone
 * `manual` session so you can just type a URL and browse. The native
 * `WebContentsView` is hidden when the pane is collapsed (`codeHidden`).
 */
export function BrowserPane({ activeRunId }: BrowserPaneProps) {
  const agentId = useRunStore((s) =>
    activeRunId ? (s.byId[activeRunId]?.agentId ?? null) : null,
  );
  const codeHidden = useUiStore((s) => s.codeHidden);
  const browserId = agentId ?? MANUAL_BROWSER_ID;
  const browser = useBrowser(browserId);

  if (!browser.isDesktop) {
    return (
      <BrowserEmpty body="The embedded browser is only available in the desktop app." />
    );
  }

  return (
    <div className="browser-pane">
      <BrowserUrlBar
        state={browser.state}
        onNavigate={browser.navigate}
        onBack={browser.back}
        onForward={browser.forward}
        onReload={browser.reload}
        onStop={browser.stop}
      />
      <div className="browser-pane__viewport">
        <BrowserViewPlaceholder agentId={browserId} active={!codeHidden} />
        {!browser.state.exists ? (
          <div className="browser-pane__hint">
            <GlobeIcon className="size-7" />
            <p>Enter a URL above to start browsing.</p>
          </div>
        ) : null}
      </div>
      <BrowserStatusStrip state={browser.state} />
    </div>
  );
}

function BrowserEmpty({ body }: { body: string }) {
  return (
    <div className="right-pane__placeholder">
      <GlobeIcon className="size-7" />
      <div className="right-pane__placeholder-title">Browser</div>
      <p className="right-pane__placeholder-body">{body}</p>
    </div>
  );
}
