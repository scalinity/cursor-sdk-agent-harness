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
 * is flushed in order. The queue is capped at OUTBOUND_QUEUE_LIMIT so a
 * long outage doesn't grow unbounded; old subscribe/unsubscribe frames
 * for the same run_id are deduped (newer supersedes older) to avoid
 * replaying obsolete intent after reconnect.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { serverFrameSchema, type ClientFrame, type ServerFrame } from "@harness/shared";
import type { ConnectionState } from "../state/ui-store.js";

const RECONNECT_BASE_MS = 250;
const RECONNECT_MAX_MS = 10_000;
const RECONNECT_JITTER = 0.25;
const RECONNECT_MAX_ATTEMPTS = 20;
const STALE_TIMEOUT_MS = 45_000;
const OUTBOUND_QUEUE_LIMIT = 64;

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
  /** Per-socket listener controller; aborted when the socket is abandoned. */
  socketAbort: AbortController | null;
  attempt: number;
  outboundQueue: ClientFrame[];
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  staleTimer: ReturnType<typeof setTimeout> | null;
  disposed: boolean;
  /** Count of swallowed heartbeat-ack send errors. Exposed via console for debugging. */
  missedHeartbeatAcks: number;
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

/**
 * Pushes a frame into the bounded outbound queue, deduping where it's
 * safe to do so:
 *
 * - For `subscribe_run` / `unsubscribe_run` / `cancel_run`, an older
 *   queued frame targeting the same `run_id` is replaced. This avoids
 *   replaying a stale subscribe-then-unsubscribe pair to a run the user
 *   has since abandoned.
 * - Other frame types append.
 *
 * When the queue exceeds OUTBOUND_QUEUE_LIMIT, the oldest non-heartbeat
 * frame is dropped (and the count surfaced via console for debugging).
 */
function enqueue(internal: InternalState, frame: ClientFrame): void {
  const queue = internal.outboundQueue;
  if (
    frame.type === "subscribe_run" ||
    frame.type === "unsubscribe_run" ||
    frame.type === "cancel_run"
  ) {
    for (let i = 0; i < queue.length; i++) {
      const existing = queue[i]!;
      if (
        (existing.type === "subscribe_run" ||
          existing.type === "unsubscribe_run" ||
          existing.type === "cancel_run") &&
        existing.run_id === frame.run_id
      ) {
        queue[i] = frame;
        return;
      }
    }
  }
  queue.push(frame);
  if (queue.length > OUTBOUND_QUEUE_LIMIT) {
    // Drop the oldest non-heartbeat-ack frame to bound memory under long
    // outages. Heartbeat-acks are time-sensitive; we'd rather drop a
    // stale subscribe than starve the keepalive.
    const dropIdx = queue.findIndex((f) => f.type !== "heartbeat_ack");
    queue.splice(dropIdx >= 0 ? dropIdx : 0, 1);
    console.warn("[useWebSocket] outbound queue exceeded limit; dropped one frame");
  }
}

export function useWebSocket(config: UseWebSocketConfig): UseWebSocketResult {
  const { url, csrfToken, onFrame, onStateChange } = config;
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const internalRef = useRef<InternalState>({
    socket: null,
    socketAbort: null,
    attempt: 0,
    outboundQueue: [],
    reconnectTimer: null,
    staleTimer: null,
    disposed: false,
    missedHeartbeatAcks: 0,
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

  // Flush the outbound queue by walking forward with an index pointer
  // instead of Array.shift() — avoids the O(n²) cost on long queues. Any
  // send failure mid-flush retains the unflushed tail for the next open.
  const flushQueue = useCallback(() => {
    const internal = internalRef.current;
    const sock = internal.socket;
    if (!sock || sock.readyState !== WebSocket.OPEN) return;
    const queue = internal.outboundQueue;
    let i = 0;
    for (; i < queue.length; i++) {
      try {
        sock.send(JSON.stringify(queue[i]!));
      } catch {
        break;
      }
    }
    if (i === 0) return;
    if (i === queue.length) {
      queue.length = 0;
    } else {
      queue.splice(0, i);
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
    // Tie all listeners to a per-socket AbortController so we can detach
    // them deterministically when the socket is abandoned. Without this,
    // long reconnect cycles retain closures on every prior socket until
    // the browser GC runs.
    const ctl = new AbortController();
    internal.socket = socket;
    internal.socketAbort = ctl;

    socket.addEventListener(
      "open",
      () => {
        if (internal.disposed) return;
        internal.attempt = 0;
        transition("open");
        resetStaleTimer();
        flushQueue();
      },
      { signal: ctl.signal },
    );

    socket.addEventListener(
      "message",
      (event) => {
        if (internal.disposed) return;
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
          } catch (err) {
            // Heartbeat-ack failures are normally invisible — surface via
            // console.debug + a running counter so a wedge can be diagnosed.
            internal.missedHeartbeatAcks += 1;
            console.debug(
              "[useWebSocket] heartbeat ack send failed",
              { missed: internal.missedHeartbeatAcks, err },
            );
          }
        }
        onFrameRef.current(frame);
      },
      { signal: ctl.signal },
    );

    socket.addEventListener(
      "close",
      () => {
        if (internal.staleTimer) clearTimeout(internal.staleTimer);
        internal.staleTimer = null;
        // Detach this socket's listeners — even though `close` is the last
        // event, error handlers might still be queued by the browser; the
        // abort prevents any further dispatch.
        ctl.abort();
        if (internal.socketAbort === ctl) internal.socketAbort = null;
        if (internal.socket === socket) internal.socket = null;
        if (internal.disposed) return;
        // Increment-before-check so the spec's "max 20 retries" matches the
        // actual schedule. Previously the cap let one extra retry through.
        internal.attempt += 1;
        if (internal.attempt > RECONNECT_MAX_ATTEMPTS) {
          transition("error");
          return;
        }
        // backoffMs takes the count of prior retries (attempt - 1) so the
        // first retry uses the documented 250ms ± jitter.
        const delay = backoffMs(internal.attempt - 1);
        transition("reconnecting");
        internal.reconnectTimer = setTimeout(() => {
          connect();
        }, delay);
      },
      { signal: ctl.signal },
    );

    socket.addEventListener(
      "error",
      () => {
        // Browsers fire `close` right after `error` — defer to that.
      },
      { signal: ctl.signal },
    );
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
      // Detach any in-flight socket listeners before close. The close
      // handler is also gated by `disposed` so it can't schedule another
      // reconnect after teardown.
      internal.socketAbort?.abort();
      internal.socketAbort = null;
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
    enqueue(internal, frame);
  }, []);

  return { send, connectionState };
}
