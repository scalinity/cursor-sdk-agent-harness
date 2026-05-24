/**
 * useBrowser — live state + manual-driving actions for one agent's embedded
 * browser, talking to the Electron main process over the `browser:*` IPC seam.
 *
 * Source of truth is the main-process `BrowserController`: this hook holds a
 * mirror that is (a) seeded by a `getState` round-trip when the agent changes
 * and (b) kept fresh by the `browser:event` push stream (filtered to this
 * agent). In browser mode (no desktop bridge) `available` is false and the
 * actions are no-ops — the pane renders an empty state.
 *
 * The effect lives here (hooks may use `useEffect`; components may not — per
 * the CLAUDE.md effect policy).
 */
import { useCallback, useEffect, useState } from "react";
import type { BrowserInvokeRequest, BrowserState } from "@harness/shared";
import { desktopBridge } from "../lib/desktop-bridge.js";

function emptyState(agentId: string): BrowserState {
  return {
    agentId,
    exists: false,
    url: "",
    title: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    lastAction: null,
  };
}

export interface UseBrowserResult {
  /** Desktop bridge present AND an agent is selected. */
  available: boolean;
  /** True in desktop mode regardless of agent selection. */
  isDesktop: boolean;
  state: BrowserState;
  navigate: (url: string) => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  stop: () => void;
}

export function useBrowser(agentId: string | null): UseBrowserResult {
  const bridge = desktopBridge?.browser ?? null;
  const [state, setState] = useState<BrowserState>(() => emptyState(agentId ?? ""));

  useEffect(() => {
    if (!bridge || !agentId) {
      setState(emptyState(agentId ?? ""));
      return;
    }
    let cancelled = false;
    const unsub = bridge.onEvent((event) => {
      if (event.agentId !== agentId) return;
      if (event.kind === "state") setState(event.state);
    });
    void bridge.invoke({ op: "getState", agentId }).then((res) => {
      if (!cancelled && res.ok) setState(res.state);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [bridge, agentId]);

  const dispatch = useCallback(
    (req: BrowserInvokeRequest) => {
      if (!bridge) return;
      void bridge.invoke(req).then((res) => {
        if (res.ok) setState(res.state);
      });
    },
    [bridge],
  );

  const navigate = useCallback(
    (url: string) => {
      if (!agentId) return;
      dispatch({ op: "navigate", agentId, url });
    },
    [dispatch, agentId],
  );
  const back = useCallback(() => {
    if (agentId) dispatch({ op: "back", agentId });
  }, [dispatch, agentId]);
  const forward = useCallback(() => {
    if (agentId) dispatch({ op: "forward", agentId });
  }, [dispatch, agentId]);
  const reload = useCallback(() => {
    if (agentId) dispatch({ op: "reload", agentId });
  }, [dispatch, agentId]);
  const stop = useCallback(() => {
    if (agentId) dispatch({ op: "stop", agentId });
  }, [dispatch, agentId]);

  return {
    available: bridge !== null && agentId !== null,
    isDesktop: bridge !== null,
    state,
    navigate,
    back,
    forward,
    reload,
    stop,
  };
}
