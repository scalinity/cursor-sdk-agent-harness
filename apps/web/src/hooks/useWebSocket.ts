/**
 * useWebSocket — owns one persistent WS connection to /ws.
 *
 * State machine:
 *   idle → connecting → open ─┬─→ reconnecting → connecting → open
 *                             └─→ closed | error
 *
 * Reconnect uses exponential backoff `min(250ms * 2^attempt, 10_000ms)`
 * with ±25% jitter, capped at 20 attempts before surfacing `error`.
 *
 * Heartbeats: the server pings every 15s. If we go 45s without receiving
 * any message we treat the socket as stale and force a reconnect. We also
 * respond to server `heartbeat` frames with a `heartbeat_ack` frame.
 *
 * Outbound `send` queues frames while in `connecting`; on `open` the queue
 * is flushed in order.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { serverFrameSchema, type ClientFrame, type ServerFrame } from "@harness/shared";
import type { ConnectionState } from "../state/ui-store.js";

const RECONNECT_BASE_MS = 250;
const RECONNECT_MAX_MS = 10_000;
const RECONNECT_JITTER = 0.25;
const RECONNECT_MAX_ATTEMPTS = 20;
const STALE_TIMEOUT_MS = 45_000;

export interface UseWebSocketConfig {
  /** Absolute or relative URL of the WS endpoint (without CSRF query). */
  url: string;
  csrfToken: string | null;
  onFrame: (frame: ServerFrame) => void;
  onStateChange?: (state: ConnectionState) => void;
}

export interface UseWebSocketResult {
  send: (frame: ClientFrame) => void;
  connectionState: ConnectionState;
}

interface InternalState {
  socket: WebSocket | null;
  attempt: number;
  outboundQueue: ClientFrame[];
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  staleTimer: ReturnType<typeof setTimeout> | null;
  disposed: boolean;
}

function backoffMs(attempt: number): number {
  const raw = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
  const jitterRange = raw * RECONNECT_JITTER;
  return raw + (Math.random() * 2 - 1) * jitterRange;
}

function buildWsUrl(url: string, csrfToken: string): string {
  // Browser only — `window.location` is always available in the harness.
  const isAbsolute = url.startsWith("ws://") || url.startsWith("wss://");
  const base = isAbsolute
    ? url
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}${url}`;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}csrf=${encodeURIComponent(csrfToken)}`;
}

export function useWebSocket(config: UseWebSocketConfig): UseWebSocketResult {
  const { url, csrfToken, onFrame, onStateChange } = config;
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const internalRef = useRef<InternalState>({
    socket: null,
    attempt: 0,
    outboundQueue: [],
    reconnectTimer: null,
    staleTimer: null,
    disposed: false,
  });
  // Stable refs for the callbacks so the connect loop never tears down on
  // every parent render.
  const onFrameRef = useRef(onFrame);
  const onStateChangeRef = useRef(onStateChange);
  onFrameRef.current = onFrame;
  onStateChangeRef.current = onStateChange;

  const transition = useCallback((next: ConnectionState) => {
    setConnectionState(next);
    onStateChangeRef.current?.(next);
  }, []);

  const resetStaleTimer = useCallback(() => {
    const internal = internalRef.current;
    if (internal.staleTimer) clearTimeout(internal.staleTimer);
    internal.staleTimer = setTimeout(() => {
      // Stale socket — force reconnect.
      try {
        internal.socket?.close(4001, "stale");
      } catch {
        // ignore
      }
    }, STALE_TIMEOUT_MS);
  }, []);

  const flushQueue = useCallback(() => {
    const internal = internalRef.current;
    const sock = internal.socket;
    if (!sock || sock.readyState !== WebSocket.OPEN) return;
    while (internal.outboundQueue.length > 0) {
      const frame = internal.outboundQueue.shift()!;
      try {
        sock.send(JSON.stringify(frame));
      } catch {
        // Push it back to the front and break — we'll retry after reconnect.
        internal.outboundQueue.unshift(frame);
        break;
      }
    }
  }, []);

  // Connect / reconnect loop. Stable reference based on url + csrfToken.
  const connect = useCallback(() => {
    const internal = internalRef.current;
    if (internal.disposed || !csrfToken) return;
    transition(internal.attempt === 0 ? "connecting" : "reconnecting");

    const fullUrl = buildWsUrl(url, csrfToken);
    let socket: WebSocket;
    try {
      socket = new WebSocket(fullUrl);
    } catch {
      transition("error");
      return;
    }
    internal.socket = socket;

    socket.addEventListener("open", () => {
      internal.attempt = 0;
      transition("open");
      resetStaleTimer();
      flushQueue();
    });

    socket.addEventListener("message", (event) => {
      resetStaleTimer();
      const raw = typeof event.data === "string" ? event.data : null;
      if (!raw) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      const result = serverFrameSchema.safeParse(parsed);
      if (!result.success) return;
      const frame = result.data;
      // Auto-ack heartbeats. Drive everything else through the consumer.
      if (frame.type === "heartbeat") {
        try {
          socket.send(
            JSON.stringify({
              id: `hb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              type: "heartbeat_ack",
              sent_at: new Date().toISOString(),
              server_heartbeat_id: frame.heartbeat_id,
            } satisfies ClientFrame),
          );
        } catch {
          // ignore
        }
      }
      onFrameRef.current(frame);
    });

    socket.addEventListener("close", () => {
      if (internal.staleTimer) clearTimeout(internal.staleTimer);
      internal.staleTimer = null;
      if (internal.disposed) return;
      if (internal.attempt >= RECONNECT_MAX_ATTEMPTS) {
        transition("error");
        return;
      }
      const delay = backoffMs(internal.attempt);
      internal.attempt += 1;
      transition("reconnecting");
      internal.reconnectTimer = setTimeout(() => {
        connect();
      }, delay);
    });

    socket.addEventListener("error", () => {
      // Browsers fire `close` right after `error` — defer to that.
    });
  }, [url, csrfToken, transition, resetStaleTimer, flushQueue]);

  useEffect(() => {
    const internal = internalRef.current;
    internal.disposed = false;
    internal.attempt = 0;
    if (csrfToken) {
      connect();
    } else {
      transition("idle");
    }
    return () => {
      internal.disposed = true;
      if (internal.reconnectTimer) clearTimeout(internal.reconnectTimer);
      if (internal.staleTimer) clearTimeout(internal.staleTimer);
      try {
        internal.socket?.close(1000, "unmount");
      } catch {
        // ignore
      }
      internal.socket = null;
      internal.outboundQueue = [];
      transition("closed");
    };
  }, [csrfToken, connect, transition]);

  const send = useCallback((frame: ClientFrame) => {
    const internal = internalRef.current;
    const sock = internal.socket;
    if (sock && sock.readyState === WebSocket.OPEN) {
      try {
        sock.send(JSON.stringify(frame));
        return;
      } catch {
        // Fall through to queue.
      }
    }
    internal.outboundQueue.push(frame);
  }, []);

  return { send, connectionState };
}
