/**
 * useNativeMenuActions — subscribes to native menu IPC events from the Electron
 * main process. In browser mode the desktopBridge is null and this hook
 * becomes a silent no-op.
 *
 * Each handler is registered for the lifetime of the hook instance; the
 * preload-side `onMenuAction` returns an unsubscribe function which we run on
 * cleanup. The hook uses a mount-only effect because handler functions can be
 * recreated every render and we don't want to rebind IPC listeners on every
 * keystroke; consumers route their stable handlers through a ref via useRef
 * outside the hook if they need reactivity. For Phase 16 the handlers come
 * from `AppShell` and are wrapped in stable `useCallback` closures.
 */
import { useEffect, useRef } from "react";
import { desktopMenuChannels } from "@harness/shared";
import { desktopBridge, type MenuActionChannel } from "../lib/desktop-bridge.js";

export type MenuActionHandlers = Partial<
  Record<MenuActionChannel, () => void>
>;

export function useNativeMenuActions(handlers: MenuActionHandlers): void {
  // Keep latest handlers in a ref so we don't unbind IPC listeners every time
  // the parent re-renders with a new closure.
  const ref = useRef(handlers);
  ref.current = handlers;

  // Mount-only IPC binding. Allowed inside hooks per the CLAUDE.md effect
  // policy ("Allowed in apps/web/src/hooks/**").
  useEffect(() => {
    const bridge = desktopBridge;
    if (!bridge) return;
    const channels: MenuActionChannel[] = [...desktopMenuChannels];
    const unsubs = channels.map((channel) =>
      bridge.onMenuAction(channel, () => {
        const h = ref.current[channel];
        if (h) h();
      }),
    );
    return () => {
      for (const u of unsubs) u();
    };
  }, []);
}
