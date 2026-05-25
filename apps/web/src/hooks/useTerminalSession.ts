import { useRef, useState, type RefObject } from "react";
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

export type TerminalConnectionStatus =
  | "connecting"
  | "connected"
  | "exited"
  | "disconnected";

export interface UseTerminalSessionResult {
  hostRef: RefObject<HTMLDivElement | null>;
  status: TerminalConnectionStatus;
}

/** Delay before re-dialing after a close or shell exit (fresh shell respawn). */
const RECONNECT_DELAY_MS = 600;

/** Build the `/ws/terminal` URL with the CSRF query param (browsers can't set
 *  custom headers on a WS upgrade), resolving relative→absolute like the run
 *  socket does. */
function buildTerminalWsUrl(csrfToken: string): string {
  const base = wsUrl("/ws/terminal");
  const isAbsolute = base.startsWith("ws://") || base.startsWith("wss://");
  const full = isAbsolute
    ? base
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}${base}`;
  const sep = full.includes("?") ? "&" : "?";
  return `${full}${sep}csrf=${encodeURIComponent(csrfToken)}`;
}

/**
 * Drives an embedded xterm terminal over `/ws/terminal`. All imperative setup
 * (xterm construction, the WebSocket, ResizeObserver) lives in this hook — the
 * sanctioned home for mount-only external sync (CLAUDE.md). The consuming
 * component is a thin `<div ref={hostRef} />`.
 */
export function useTerminalSession(): UseTerminalSessionResult {
  const hostRef = useRef<HTMLDivElement | null>(null);
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
    safeFit(fit);

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let storeUnsub: (() => void) | undefined;
    let disposed = false;

    const send = (payload: string): void => {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(payload);
    };

    const dataDisposable = term.onData((data) => send(serializeTerminalInput(data)));
    const resizeDisposable = term.onResize(({ cols, rows }) =>
      send(serializeTerminalResize(cols, rows)),
    );

    const resizeObserver = new ResizeObserver(() => safeFit(fit));
    resizeObserver.observe(host);

    const scheduleReconnect = (): void => {
      if (disposed) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
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
      const ws = new WebSocket(buildTerminalWsUrl(token));
      socket = ws;
      ws.onopen = () => {
        if (!disposed) setStatus("connected");
      };
      ws.onmessage = (event: MessageEvent) => {
        const frame = parseTerminalServerFrame(
          typeof event.data === "string" ? event.data : "",
        );
        if (!frame) return;
        switch (frame.type) {
          case "ready":
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
      ws.onclose = () => {
        socket = null;
        if (disposed) return;
        setStatus((prev) => (prev === "exited" ? prev : "disconnected"));
        scheduleReconnect();
      };
      ws.onerror = () => {
        // The close handler drives the reconnect; nothing to do here.
      };
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      storeUnsub?.();
      resizeObserver.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      if (socket) {
        socket.onclose = null;
        socket.close();
        socket = null;
      }
      term.dispose();
    };
  });

  return { hostRef, status };
}

function safeFit(fit: FitAddon): void {
  try {
    fit.fit();
  } catch {
    // Host not laid out yet (e.g. tab hidden); the ResizeObserver retries.
  }
}
