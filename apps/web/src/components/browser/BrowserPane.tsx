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
 * Right-pane "Browser" surface. Resolves the owning agent from the active run
 * (one isolated browser session per agent) and drives the native
 * `WebContentsView` through `useBrowser`. The view is hidden when the pane is
 * collapsed (`codeHidden`) so the native layer never paints over the rest of
 * the shell.
 */
export function BrowserPane({ activeRunId }: BrowserPaneProps) {
  const agentId = useRunStore((s) =>
    activeRunId ? (s.byId[activeRunId]?.agentId ?? null) : null,
  );
  const codeHidden = useUiStore((s) => s.codeHidden);
  const browser = useBrowser(agentId);

  if (!browser.isDesktop) {
    return (
      <BrowserEmpty body="The embedded browser is only available in the desktop app." />
    );
  }
  if (!agentId) {
    return (
      <BrowserEmpty body="Start or select an agent to drive its isolated browser session." />
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
        <BrowserViewPlaceholder agentId={agentId} active={!codeHidden} />
        {!browser.state.exists ? (
          <div className="browser-pane__hint">
            <GlobeIcon className="size-7" />
            <p>Enter a URL above to start browsing in this agent&apos;s isolated session.</p>
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
