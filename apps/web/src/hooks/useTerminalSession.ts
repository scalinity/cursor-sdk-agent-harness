import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { wsUrl } from "../lib/api-base.js";
import { readTerminalAppearance } from "../lib/xterm-theme.js";
import {
  parseTerminalServerFrame,
  serializeTerminalInput,
  serializeTerminalResize,
} from "../lib/terminal-client.js";
import { useUiStore } from "../state/ui-store.js";
import { useMountEffect } from "./useMountEffect.js";
import { useCsrfToken } from "./useCsrfToken.js";
import { useThemeValue } from "./useTheme.js";

export type TerminalConnectionStatus = "connecting" | "connected" | "exited" | "disconnected";

export interface UseTerminalSessionResult {
  hostRef: RefObject<HTMLDivElement | null>;
  status: TerminalConnectionStatus;
  insertText: (text: string) => void;
  runText: (text: string) => void;
}

/** Delay before re-dialing after a close or shell exit (fresh shell respawn). */
const RECONNECT_DELAY_MS = 600;
const MAX_RECONNECT_DELAY_MS = 5_000;

/** Build the `/ws/terminal` URL with the CSRF query param (browsers can't set
 *  custom headers on a WS upgrade), resolving relative→absolute like the run
 *  socket does. */
function buildTerminalWsUrl(csrfToken: string, viewport: { cols: number; rows: number }): string {
  const base = wsUrl("/ws/terminal");
  const isAbsolute = base.startsWith("ws://") || base.startsWith("wss://");
  const full = isAbsolute
    ? base
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}${base}`;
  const sep = full.includes("?") ? "&" : "?";
  const params = new URLSearchParams({
    csrf: csrfToken,
    cols: String(viewport.cols),
    rows: String(viewport.rows),
  });
  return `${full}${sep}${params.toString()}`;
}

/**
 * Drives an embedded xterm terminal over `/ws/terminal`. All imperative setup
 * (xterm construction, the WebSocket, ResizeObserver) lives in this hook — the
 * sanctioned home for mount-only external sync (CLAUDE.md). The consuming
 * component is a thin `<div ref={hostRef} />`.
 */
export function useTerminalSession(): UseTerminalSessionResult {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sendRef = useRef<(payload: string) => void>(() => undefined);
  const { resolvedTheme } = useThemeValue();
  const csrf = useCsrfToken();
  const [status, setStatus] = useState<TerminalConnectionStatus>("connecting");

  useMountEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const appearance = readTerminalAppearance(host);
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: appearance.fontFamily,
      fontSize: appearance.fontSize,
      theme: appearance.theme,
      scrollback: 5_000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    terminalRef.current = term;
    fitRef.current = fit;
    safeFit(fit);

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let storeUnsub: (() => void) | undefined;
    let disposed = false;
    let reconnectAttempts = 0;
    let refreshedAfterPolicyClose = false;
    // The directory the server last reported for the live shell. A change means
    // the workspace switched and the server respawned the shell, so we clear the
    // stale screen. null until the first `ready`, so a tab-switch reattach to the
    // same shell never wipes the restored scrollback.
    let lastCwd: string | null = null;

    const send = (payload: string): void => {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(payload);
    };
    sendRef.current = send;

    const dataDisposable = term.onData((data) => send(serializeTerminalInput(data)));
    const resizeDisposable = term.onResize(({ cols, rows }) =>
      send(serializeTerminalResize(cols, rows)),
    );

    const resizeObserver = new ResizeObserver(() => safeFit(fit));
    resizeObserver.observe(host);

    // Refit once the mono web font has finished loading. xterm sizes columns
    // against the cell width measured at open(); if 'JetBrains Mono' (loaded
    // async via Google Fonts) wasn't ready, it measured the narrower fallback,
    // over-counted columns, and the rightmost glyphs clipped once the wider
    // face painted. Nothing else refits on a font swap, so the clip persisted.
    refitWhenFontReady(appearance, fit, () => disposed);

    const scheduleReconnect = (): void => {
      if (disposed) return;
      clearTimeout(reconnectTimer);
      const delay = Math.min(
        RECONNECT_DELAY_MS * 2 ** reconnectAttempts,
        MAX_RECONNECT_DELAY_MS,
      );
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    function connect(): void {
      if (disposed) return;
      const token = useUiStore.getState().csrfToken;
      if (!token) {
        // CSRF not minted yet (cold boot). Connect the moment it lands.
        setStatus("connecting");
        storeUnsub?.();
        storeUnsub = useUiStore.subscribe((s) => {
          if (s.csrfToken) {
            storeUnsub?.();
            storeUnsub = undefined;
            connect();
          }
        });
        return;
      }
      setStatus("connecting");
      safeFit(fit);
      const ws = new WebSocket(buildTerminalWsUrl(token, { cols: term.cols, rows: term.rows }));
      socket = ws;
      ws.onopen = () => {
        if (disposed || socket !== ws) return;
        reconnectAttempts = 0;
        refreshedAfterPolicyClose = false;
        setStatus("connected");
      };
      ws.onmessage = (event: MessageEvent) => {
        if (disposed || socket !== ws) return;
        const frame = parseTerminalServerFrame(typeof event.data === "string" ? event.data : "");
        if (!frame) return;
        switch (frame.type) {
          case "ready":
            if (lastCwd !== null && frame.cwd !== lastCwd) {
              term.reset();
            }
            lastCwd = frame.cwd;
            safeFit(fit);
            send(serializeTerminalResize(term.cols, term.rows));
            setStatus("connected");
            return;
          case "data":
            term.write(frame.data);
            return;
          case "exit":
            term.write("\r\n[2m[process exited — restarting…][0m\r\n");
            setStatus("exited");
            // Respawn a fresh shell: close drives onclose → scheduleReconnect.
            ws.close();
            return;
          case "error":
            term.write(`\r\n[31m[terminal error: ${frame.message}][0m\r\n`);
            return;
        }
      };
      ws.onclose = (event: CloseEvent) => {
        if (socket !== ws) return;
        socket = null;
        if (disposed) return;
        setStatus((prev) => (prev === "exited" ? prev : "disconnected"));
        if (event.code === 1008 && !refreshedAfterPolicyClose) {
          refreshedAfterPolicyClose = true;
          void csrf.refresh().finally(scheduleReconnect);
          return;
        }
        scheduleReconnect();
      };
      ws.onerror = () => {
        if (socket !== ws) return;
        // The close handler drives the reconnect; nothing to do here.
      };
    }

    connect();

    // Re-dial when the active workspace changes so the shell follows it. The
    // server replaces the PTY with one rooted in the new directory on reattach,
    // and the `ready` cwd-change check above clears the stale screen. Closing
    // the socket drives onclose → scheduleReconnect → connect (a fresh shell);
    // if it's already closed, schedule the reconnect directly.
    const workspaceUnsub = useUiStore.subscribe((s, prev) => {
      if (s.activeWorkspaceId === prev.activeWorkspaceId) return;
      if (socket) {
        socket.close();
      } else {
        scheduleReconnect();
      }
    });

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      storeUnsub?.();
      workspaceUnsub();
      resizeObserver.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      if (socket) {
        socket.onclose = null;
        socket.close();
        socket = null;
      }
      term.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      sendRef.current = () => undefined;
    };
  });

  useEffect(() => {
    const host = hostRef.current;
    const term = terminalRef.current;
    const fit = fitRef.current;
    if (!host || !term) return;

    const appearance = readTerminalAppearance(host);
    term.options.theme = appearance.theme;
    term.options.fontFamily = appearance.fontFamily;
    term.options.fontSize = appearance.fontSize;
    if (fit) safeFit(fit);
  }, [resolvedTheme]);

  const insertText = useCallback((text: string): void => {
    sendRef.current(serializeTerminalInput(text));
  }, []);

  const runText = useCallback((text: string): void => {
    sendRef.current(serializeTerminalInput(`${text}\r`));
  }, []);

  return { hostRef, status, insertText, runText };
}

function safeFit(fit: FitAddon): void {
  try {
    fit.fit();
  } catch {
    // Host not laid out yet (e.g. tab hidden); the ResizeObserver retries.
  }
}

/**
 * Refit the terminal once the primary mono web font is loaded so the column
 * count matches its real cell width (see call site for why this clips otherwise).
 * `fit()` no-ops when the count is already correct (warm font cache); a changed
 * count fires `term.onResize`, which re-syncs the PTY.
 */
function refitWhenFontReady(
  appearance: { fontFamily: string; fontSize: number },
  fit: FitAddon,
  isDisposed: () => boolean,
): void {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const primaryFamily = appearance.fontFamily.split(",")[0]?.trim() || "monospace";
  void document.fonts.load(`${appearance.fontSize}px ${primaryFamily}`).then(
    () => {
      if (!isDisposed()) safeFit(fit);
    },
    () => {
      // Font blocked/offline — the fallback stays; nothing to refit.
    },
  );
}
