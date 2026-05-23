import { randomUUID } from "node:crypto";
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from "fastify";
import fp from "fastify-plugin";
import type { WebSocket, RawData } from "ws";
import {
  clientFrameSchema,
  serverFrameSchema,
  type ClientFrame,
  type EventRow,
  type ServerFrame,
  type WsErrorCode,
} from "@harness/shared";
import type { EventsRepo } from "../db/repositories/events.repo.js";
import type { RunsRepo } from "../db/repositories/runs.repo.js";
import type { ActiveRuns } from "../sdk/active-runs.js";
import type { CancelResult } from "../sdk/run-controller.js";
import type { CsrfTokenizer } from "../security/csrf.js";
import { buildServerFrame } from "./frame-builder.js";
import type { RunBus } from "./run-bus.js";

/**
 * Heartbeat schedule per spec §4 "Heartbeat and Reconnection Contract".
 *
 *  - Server sends `heartbeat` every PING_INTERVAL_MS.
 *  - Client must reply with `heartbeat_ack` within MISSED_PONG_TIMEOUT_MS.
 *  - If MISSED_PONG_TIMEOUT_MS elapses without a pong, close 4002.
 *
 * The numbers are tuned to detect a dead local socket within ~45s while
 * tolerating one missed beat across tab-sleep. Tests override via
 * `WsPluginOptions.heartbeatIntervalMs` to exercise the timer without
 * waiting full production cadence.
 */
const DEFAULT_PING_INTERVAL_MS = 15_000;
const DEFAULT_MISSED_PONG_TIMEOUT_MS = 45_000;

/**
 * Pagination cap on each replay batch read out of SQLite. Large runs replay
 * in multiple batches; the client never sees the boundary because we don't
 * announce ack until we've caught up to `runs.last_seq`.
 */
const REPLAY_PAGE_SIZE = 200;

/**
 * Maximum backlog of canonical events buffered between the live bus and the
 * socket. If a slow socket falls more than MAX_LIVE_BACKLOG behind, the
 * server closes that subscription with `retryable = true` so the client
 * resyncs from SQLite (spec §13 Backpressure decision).
 */
const MAX_LIVE_BACKLOG = 1_000;

export interface WsPluginOptions {
  csrf: CsrfTokenizer;
  allowedOrigin: string;
  events: EventsRepo;
  runs: RunsRepo;
  bus: RunBus;
  activeRuns: ActiveRuns;
  /**
   * Optional storage for approval responses received over WS. Phase 13 will
   * wire this to the real `ApprovalResponder`; in Phase 07 we simply log
   * receipt so no fake resolution can happen.
   */
  onApprovalResponse?: (input: {
    runId: string;
    requestId: string;
    decision: "approve" | "deny";
    reason?: string;
    payload?: unknown;
  }) => void;
  /** Override the heartbeat ping interval (ms). Defaults to 15s. */
  heartbeatIntervalMs?: number;
  /** Override the missed-pong timeout (ms). Defaults to 45s. */
  missedPongTimeoutMs?: number;
}

/**
 * Per-connection state. The connection registry lives inside the plugin
 * closure — there's no need for a separate file because the plugin is the
 * sole owner.
 */
interface ConnectionState {
  socket: WebSocket;
  log: FastifyBaseLogger;
  /** Map of runId → unsubscribe from the bus AND its pending queue. */
  subscriptions: Map<string, RunSubscription>;
  /** Last pong observed; used by the heartbeat watcher to detect dead peers. */
  lastPongAt: number;
  /** Heartbeat interval timer; cleared on close. */
  heartbeatTimer: NodeJS.Timeout;
  /** Dedupe queue for inbound client frame IDs (spec §4 "Backend rules"). */
  recentFrameIds: Set<string>;
  closed: boolean;
}

interface RunSubscription {
  /** Returns true while replay is still flushing; false once live. */
  replaying: boolean;
  /** Live events queued during replay; flushed when replay completes. */
  liveQueue: EventRow[];
  unsubscribe: () => void;
}

const wsPluginImpl: FastifyPluginAsync<WsPluginOptions> = async (
  app: FastifyInstance,
  opts: WsPluginOptions,
) => {
  app.get(
    "/ws",
    { websocket: true },
    (socket: WebSocket, req: FastifyRequest) => {
      const reqLog = req.log;
      // Origin and CSRF gates BEFORE we attach any handlers. A rejected
      // upgrade closes the socket immediately with the appropriate code.
      const upgradeError = validateUpgrade(req, opts);
      if (upgradeError) {
        reqLog.warn({ code: upgradeError.code }, "ws: upgrade rejected");
        sendOrSwallow(socket, errorFrame(upgradeError.code, upgradeError.message));
        // 1008 = policy violation (CSRF / origin).
        socket.close(1008, upgradeError.message);
        return;
      }

      const state = createConnection(socket, reqLog, opts);

      socket.on("message", (data: RawData) => {
        handleClientFrame(state, data, opts);
      });

      socket.on("close", () => {
        teardownConnection(state);
      });

      socket.on("error", (err: Error) => {
        reqLog.warn({ err }, "ws: socket error");
        teardownConnection(state);
      });
    },
  );
};

export const wsPlugin = fp(wsPluginImpl, {
  name: "harness-ws",
  // `@fastify/websocket` must be registered before this plugin.
  dependencies: [],
});

function validateUpgrade(
  req: FastifyRequest,
  opts: WsPluginOptions,
): { code: WsErrorCode; message: string } | null {
  const origin = req.headers.origin;
  if (!origin || origin !== opts.allowedOrigin) {
    return { code: "UNAUTHORIZED_ORIGIN", message: "Origin not allowed" };
  }
  const query = req.query as { csrf?: string } | undefined;
  const token = query?.csrf;
  if (typeof token !== "string" || token.length === 0) {
    return { code: "CSRF_FAILED", message: "Missing csrf query parameter" };
  }
  if (!opts.csrf.validate(token)) {
    return { code: "CSRF_FAILED", message: "Invalid CSRF token" };
  }
  return null;
}

function createConnection(
  socket: WebSocket,
  log: FastifyBaseLogger,
  opts: WsPluginOptions,
): ConnectionState {
  const pingMs = opts.heartbeatIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const missedMs = opts.missedPongTimeoutMs ?? DEFAULT_MISSED_PONG_TIMEOUT_MS;
  const state: ConnectionState = {
    socket,
    log,
    subscriptions: new Map(),
    lastPongAt: Date.now(),
    heartbeatTimer: setInterval(() => {
      runHeartbeatTick(state, missedMs);
    }, pingMs),
    recentFrameIds: new Set(),
    closed: false,
  };
  // First heartbeat is deferred to the next tick so the client has time to
  // attach its `on('message')` handler after `injectWS`/upgrade resolves.
  // setImmediate gives the awaiting test (and a real browser client) a clean
  // microtask boundary before the first frame goes out.
  setImmediate(() => sendHeartbeat(state));
  // Don't unref the heartbeat timer — Fastify's app.close should be the
  // only way to drop active sockets, and we want the timer to keep the
  // process up for as long as the WS is live.
  return state;
}

function teardownConnection(state: ConnectionState): void {
  if (state.closed) return;
  state.closed = true;
  clearInterval(state.heartbeatTimer);
  for (const sub of state.subscriptions.values()) {
    sub.unsubscribe();
  }
  state.subscriptions.clear();
}

function runHeartbeatTick(state: ConnectionState, missedPongTimeoutMs: number): void {
  if (state.closed) return;
  const elapsedSinceLastPong = Date.now() - state.lastPongAt;
  if (elapsedSinceLastPong > missedPongTimeoutMs) {
    state.log.warn(
      { elapsedSinceLastPong },
      "ws: heartbeat timeout, closing with 4002",
    );
    try {
      state.socket.close(4002, "heartbeat timeout");
    } catch {
      // socket may already be dead — fall through to teardown
    }
    teardownConnection(state);
    return;
  }
  sendHeartbeat(state);
}

function sendHeartbeat(state: ConnectionState): void {
  const id = randomUUID();
  const frame: ServerFrame = {
    id,
    type: "heartbeat",
    sent_at: new Date().toISOString(),
    heartbeat_id: id,
    server_time: new Date().toISOString(),
  };
  sendFrame(state, frame);
}

function handleClientFrame(
  state: ConnectionState,
  data: RawData,
  opts: WsPluginOptions,
): void {
  if (state.closed) return;
  let raw: unknown;
  try {
    raw = JSON.parse(rawDataToString(data));
  } catch {
    sendFrame(state, errorFrame("VALIDATION_ERROR", "Frame is not valid JSON"));
    return;
  }
  const parsed = clientFrameSchema.safeParse(raw);
  if (!parsed.success) {
    const ackId = extractIdFromUnknown(raw);
    sendFrame(
      state,
      errorFrame("VALIDATION_ERROR", "Frame failed schema validation", {
        ...(ackId !== undefined ? { ack_for: ackId } : {}),
        details: parsed.error.flatten(),
      }),
    );
    return;
  }
  const frame = parsed.data;
  // Spec §4: "Deduplicate client commands by `id` for 10 minutes per
  // connection." 10-minute pruning is approximated by a per-connection set
  // that we cap; heartbeat_ack is exempt because the same id never repeats.
  if (frame.type !== "heartbeat_ack" && state.recentFrameIds.has(frame.id)) {
    sendFrame(
      state,
      ackFrame(frame.id, { message: "duplicate frame id; idempotent reply" }),
    );
    return;
  }
  if (frame.type !== "heartbeat_ack") {
    state.recentFrameIds.add(frame.id);
    if (state.recentFrameIds.size > 1024) {
      // Naive eviction — toss the oldest insertion to bound memory.
      const first = state.recentFrameIds.values().next().value;
      if (first !== undefined) state.recentFrameIds.delete(first);
    }
  }

  switch (frame.type) {
    case "heartbeat_ack":
      state.lastPongAt = Date.now();
      return;
    case "subscribe_run":
      void handleSubscribeRun(state, frame, opts);
      return;
    case "unsubscribe_run":
      handleUnsubscribeRun(state, frame);
      return;
    case "cancel_run":
      void handleCancelRun(state, frame, opts);
      return;
    case "approval_response":
      handleApprovalResponse(state, frame, opts);
      return;
    case "submit_user_input":
    case "delete_run":
    case "update_settings":
      // Reserved for Phases 08+ — acknowledge so the client knows the frame
      // landed; surface an error so a future caller doesn't think we
      // silently processed it.
      sendFrame(
        state,
        errorFrame("INTERNAL_ERROR", `Frame type ${frame.type} not yet implemented over WS`, {
          ack_for: frame.id,
        }),
      );
      return;
    default: {
      // Exhaustiveness check — the discriminated union should cover every
      // case. If a new frame lands here, the build catches it.
      const _exhaustive: never = frame;
      void _exhaustive;
      return;
    }
  }
}

async function handleSubscribeRun(
  state: ConnectionState,
  frame: Extract<ClientFrame, { type: "subscribe_run" }>,
  opts: WsPluginOptions,
): Promise<void> {
  const run = opts.runs.getById(frame.run_id);
  if (!run) {
    sendFrame(
      state,
      errorFrame("RUN_NOT_FOUND", `Unknown run_id=${frame.run_id}`, {
        ack_for: frame.id,
      }),
    );
    return;
  }
  if (state.subscriptions.has(frame.run_id)) {
    // Already subscribed — replay from the new cursor without touching the
    // existing bus subscription. Avoids duplicate liveQueue entries.
    sendFrame(
      state,
      ackFrame(frame.id, { message: "already subscribed; replay reissued" }),
    );
    await runReplay(state, frame.run_id, frame.after_seq, opts);
    return;
  }

  // Open the subscription FIRST so any event published mid-replay is queued
  // and won't be lost in the gap between snapshot read and live attach.
  const subscription: RunSubscription = {
    replaying: true,
    liveQueue: [],
    unsubscribe: () => {
      // populated below
    },
  };
  const unsubscribe = opts.bus.subscribe(frame.run_id, (event) => {
    if (state.closed) return;
    if (subscription.replaying) {
      subscription.liveQueue.push(event);
      if (subscription.liveQueue.length > MAX_LIVE_BACKLOG) {
        // Backpressure trigger — see MAX_LIVE_BACKLOG comment.
        sendFrame(
          state,
          errorFrame(
            "INTERNAL_ERROR",
            `Subscription backlog exceeded ${MAX_LIVE_BACKLOG}; resync from SQLite`,
            { retryable: true, ack_for: frame.id },
          ),
        );
        const sub = state.subscriptions.get(frame.run_id);
        if (sub) {
          sub.unsubscribe();
          state.subscriptions.delete(frame.run_id);
        }
        return;
      }
      return;
    }
    deliverEvent(state, event, false);
  });
  subscription.unsubscribe = unsubscribe;
  state.subscriptions.set(frame.run_id, subscription);

  await runReplay(state, frame.run_id, frame.after_seq, opts);

  // Drain any live events that arrived during replay BEFORE flipping the
  // subscription to live mode. Otherwise a race could deliver a live event
  // ahead of the queued ones.
  const drained = subscription.liveQueue.splice(0, subscription.liveQueue.length);
  for (const event of drained) {
    deliverEvent(state, event, false);
  }
  subscription.replaying = false;
  sendFrame(state, ackFrame(frame.id, { replay_complete: true }));
}

async function runReplay(
  state: ConnectionState,
  runId: string,
  afterSeq: number,
  opts: WsPluginOptions,
): Promise<void> {
  let cursor = afterSeq;
  // Paginate through SQLite so a 50k-event run doesn't allocate the whole
  // list in memory at once. Loop breaks via internal returns once the
  // last page is exhausted or the connection closes.
  for (;;) {
    if (state.closed) return;
    const rows = opts.events.getByRunIdAfterSeq(runId, cursor, REPLAY_PAGE_SIZE);
    if (rows.length === 0) return;
    for (const row of rows) {
      deliverEvent(state, row, true);
    }
    const last = rows[rows.length - 1];
    if (!last) return;
    if (last.seq <= cursor) return; // safety guard against pathological data
    cursor = last.seq;
    if (rows.length < REPLAY_PAGE_SIZE) return;
  }
}

function deliverEvent(
  state: ConnectionState,
  row: EventRow,
  replayed: boolean,
): void {
  const frame = buildServerFrame(row, { replayed });
  if (frame === null) return;
  // Validate every outbound event frame against the shared schema before
  // sending. A bad shape gets surfaced as an error frame instead of being
  // shipped and quietly breaking the client.
  const result = serverFrameSchema.safeParse(frame);
  if (!result.success) {
    state.log.error(
      { kind: row.kind, eventId: row.id, errors: result.error.flatten() },
      "ws: outbound event frame failed schema validation",
    );
    sendFrame(
      state,
      errorFrame("INTERNAL_ERROR", "Server produced an invalid frame", {
        details: { kind: row.kind, eventId: row.id },
      }),
    );
    return;
  }
  sendFrame(state, frame);
}

function handleUnsubscribeRun(
  state: ConnectionState,
  frame: Extract<ClientFrame, { type: "unsubscribe_run" }>,
): void {
  const sub = state.subscriptions.get(frame.run_id);
  if (sub) {
    sub.unsubscribe();
    state.subscriptions.delete(frame.run_id);
  }
  sendFrame(state, ackFrame(frame.id));
}

async function handleCancelRun(
  state: ConnectionState,
  frame: Extract<ClientFrame, { type: "cancel_run" }>,
  opts: WsPluginOptions,
): Promise<void> {
  const controller = opts.activeRuns.get(frame.run_id);
  if (!controller) {
    sendFrame(
      state,
      errorFrame("RUN_NOT_FOUND", `No active run for id=${frame.run_id}`, {
        ack_for: frame.id,
      }),
    );
    return;
  }
  try {
    const result: CancelResult = await controller.cancel("user_cancelled");
    switch (result.outcome) {
      case "cancelled":
        sendFrame(state, ackFrame(frame.id, { message: "cancelled" }));
        return;
      case "unsupported":
        sendFrame(
          state,
          errorFrame(
            "CANCEL_UNAVAILABLE",
            result.unsupportedReason ?? "SDK reports cancel is not supported",
            { ack_for: frame.id },
          ),
        );
        return;
      case "not_started":
        sendFrame(
          state,
          errorFrame(
            "CANCEL_UNAVAILABLE",
            "Run has not started yet; nothing to cancel",
            { ack_for: frame.id },
          ),
        );
        return;
      case "failed":
        sendFrame(
          state,
          errorFrame("SDK_ERROR", "SDK cancel() threw", {
            ack_for: frame.id,
            details:
              result.error instanceof Error
                ? result.error.message
                : String(result.error),
          }),
        );
        return;
    }
  } catch (err) {
    state.log.error({ err, runId: frame.run_id }, "ws: cancel_run threw");
    sendFrame(
      state,
      errorFrame("SDK_ERROR", "cancel_run failed", {
        ack_for: frame.id,
        details: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

function handleApprovalResponse(
  state: ConnectionState,
  frame: Extract<ClientFrame, { type: "approval_response" }>,
  opts: WsPluginOptions,
): void {
  // Per OQ-10 there's no SDK method to resolve approval. We persist receipt
  // so the UI can record the user's intent, but the resolver is wired in
  // Phase 13. NEVER fake resolution success here.
  if (opts.onApprovalResponse) {
    opts.onApprovalResponse({
      runId: frame.run_id,
      requestId: frame.request_id,
      decision: frame.decision,
      ...(frame.reason !== undefined ? { reason: frame.reason } : {}),
      ...(frame.payload !== undefined ? { payload: frame.payload } : {}),
    });
  }
  // Today we have no resolver — surface APPROVAL not pending so the client
  // sees an explicit failure rather than a silent ack.
  sendFrame(
    state,
    errorFrame(
      "APPROVAL_NOT_PENDING",
      "Approval responder is not yet wired (Phase 13)",
      { ack_for: frame.id },
    ),
  );
}

function ackFrame(
  ackFor: string,
  extras: { message?: string; replay_complete?: boolean } = {},
): ServerFrame {
  return {
    id: randomUUID(),
    type: "ack",
    sent_at: new Date().toISOString(),
    ack_for: ackFor,
    ok: true,
    ...(extras.message !== undefined ? { message: extras.message } : {}),
    ...(extras.replay_complete !== undefined
      ? { replay_complete: extras.replay_complete }
      : {}),
  };
}

function errorFrame(
  code: WsErrorCode,
  message: string,
  extras: { ack_for?: string; details?: unknown; retryable?: boolean } = {},
): ServerFrame {
  return {
    id: randomUUID(),
    type: "error",
    sent_at: new Date().toISOString(),
    code,
    message,
    retryable: extras.retryable ?? false,
    ...(extras.ack_for !== undefined ? { ack_for: extras.ack_for } : {}),
    ...(extras.details !== undefined ? { details: extras.details } : {}),
  };
}

function sendFrame(state: ConnectionState, frame: ServerFrame): void {
  if (state.closed) return;
  if (state.socket.readyState !== state.socket.OPEN) return;
  sendOrSwallow(state.socket, frame);
}

function sendOrSwallow(socket: WebSocket, frame: ServerFrame): void {
  try {
    socket.send(JSON.stringify(frame));
  } catch {
    // Best-effort — a failed send during shutdown is benign.
  }
}

function extractIdFromUnknown(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const id = (raw as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

/**
 * Normalise the four `ws` RawData shapes to a UTF-8 string. `ws` may deliver
 * `string | Buffer | ArrayBuffer | Buffer[]` depending on the peer's framing
 * mode; the WS plugin only speaks JSON text frames so we coalesce everything
 * to a string before handing to JSON.parse.
 */
function rawDataToString(data: RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return (data as Buffer).toString("utf8");
}
