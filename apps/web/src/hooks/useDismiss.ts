import { useEffect, type RefObject } from "react";

export interface UseDismissOptions {
  /** When true, the outside-pointer + Escape listeners are attached. */
  open: boolean;
  /** Invoked on outside pointerdown or Escape. Must be stable (useCallback). */
  onDismiss: () => void;
  /**
   * The element that bounds "inside". A pointerdown anywhere outside this
   * node dismisses. Pass the wrapper that contains both trigger and popup so
   * clicking either keeps the popup open.
   */
  containerRef: RefObject<HTMLElement | null>;
}

/**
 * Dismiss-on-outside-interaction for popups (custom <Select>, menus). While
 * `open`, listens for a pointerdown outside `containerRef` or an Escape key
 * and calls `onDismiss`.
 *
 * This is a genuine external-DOM subscription (document-level listeners with
 * setup + teardown), which is why it lives in a hook: components and pages
 * may not call `useEffect` directly (ESLint `harness/no-use-effect-in-components`),
 * but hooks are the sanctioned home for true mount-scoped external sync.
 *
 * Listeners are registered in the capture phase so a dismiss fires before
 * other handlers (e.g. a second trigger opening as this one would otherwise
 * still be open), and are torn down whenever `open` flips false or the host
 * unmounts.
 */
export function useDismiss({ open, onDismiss, containerRef }: UseDismissOptions): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const container = containerRef.current;
      if (container && target && container.contains(target)) return;
      onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onDismiss, containerRef]);
}
