import { useRef } from "react";
import { useBrowserViewMount } from "../../hooks/useBrowserViewMount.js";

/**
 * An empty div whose viewport rect is reported to the Electron main process so
 * the native `WebContentsView` is positioned over it. The actual page paints in
 * the native layer above this div — nothing renders here.
 */
export function BrowserViewPlaceholder({
  agentId,
  active,
}: {
  agentId: string | null;
  active: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useBrowserViewMount(ref, agentId, active);
  return <div ref={ref} className="browser-view-host" aria-hidden="true" />;
}
