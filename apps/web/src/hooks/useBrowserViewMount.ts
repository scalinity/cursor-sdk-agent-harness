/**
 * useBrowserViewMount — reports the placeholder div's viewport rect to the
 * Electron main process so the native `WebContentsView` tracks it.
 *
 * The WebContentsView is not a DOM element; the main process positions it in
 * window content-area coordinates. The renderer fills the content area, so the
 * placeholder's `getBoundingClientRect()` maps directly to the view bounds.
 *
 * Re-reports on layout change (ResizeObserver + a body MutationObserver for
 * grid reflows like rail collapse + window resize/scroll), all coalesced to one
 * `requestAnimationFrame` per frame. When `active` is false (Browser tab not
 * showing, or right pane collapsed) or on unmount, the view is hidden so it
 * never paints over the rest of the UI.
 */
import { useEffect, type RefObject } from "react";
import { desktopBridge } from "../lib/desktop-bridge.js";

export function useBrowserViewMount<T extends HTMLElement>(
  ref: RefObject<T | null>,
  agentId: string | null,
  active: boolean,
): void {
  const bridge = desktopBridge?.browser ?? null;

  useEffect(() => {
    if (!bridge || !agentId) return;
    const el = ref.current;
    if (!el) return;

    if (!active) {
      void bridge.invoke({ op: "hide", agentId });
      return;
    }

    let raf = 0;
    const report = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        void bridge.invoke({
          op: "position",
          agentId,
          rect: { x: r.left, y: r.top, width: r.width, height: r.height },
        });
      });
    };

    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    const mo = new MutationObserver(report);
    mo.observe(document.body, { attributes: true, childList: true, subtree: true });
    window.addEventListener("resize", report);
    window.addEventListener("scroll", report, true);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", report);
      window.removeEventListener("scroll", report, true);
      void bridge.invoke({ op: "hide", agentId });
    };
  }, [bridge, agentId, active, ref]);
}
