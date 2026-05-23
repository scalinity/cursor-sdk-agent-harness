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
  frameIdSchema,
  serverFrameSchema,
  type ClientFrame,
  type EventRow,
  type ServerFrame,
  type WsErrorCode,
} from "@harness/shared";
import type { EventsRepo } from "../db/repositories/events.repo.js";
import type { RunsRepo } from "../db/repositories/runs.repo.js";
import type { ActiveRuns } from "../sdk/active-runs.js";
import type {
  ApprovalResponder,
  ApprovalResolveInput,
} from "../sdk/approval-responder.js";
import { UnimplementedApprovalError } from "../sdk/approval-responder.js";
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
 * Bound on the pending-heartbeat-id set. The missed-pong timeout
 * fires well before we'd reach this cap under normal operation
 * (interval 15s × 32 = 8 minutes), but the cap is here to defend
 * against an attacker / buggy client that connects, never acks, and
 * we never close the socket for some other reason.
 */
const MAX_PENDING_HEARTBEATS = 32;

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

/**
 * Per-connection client frame dedupe window. Spec §4 ("Deduplicate
 * client commands by `id` for 10 minutes per connection.") A
 * size-only Set would roll the window in seconds under burst load
 * (e.g. rapid subscribe/unsubscribe cycles during reconnect), so we
 * track insertion timestamps and evict by both age and size.
 */
const DEDUPE_TTL_MS = 10 * 60 * 1_000;
const DEDUPE_MAX_ENTRIES = 4_096;

export interface WsPluginOptions {
  csrf: CsrfTokenizer;
  allowedOrigin: string;
  events: EventsRepo;
  runs: RunsRepo;
  bus: RunBus;
  activeRuns: ActiveRuns;
  /** Override the heartbeat ping interval (ms). Defaults to 15s. */
  heartbeatIntervalMs?: number;
  /** Override the missed-pong timeout (ms). Defaults to 45s. */
  missedPongTimeoutMs?: number;
  /**
   * Phase 13 — approval responder. The default production responder
   * throws `UnimplementedApprovalError` because OQ-10 has no
   * resolution in `@cursor/sdk@1.0.13`. The WS plugin converts the
   * throw into an `approval.failed` canonical event with code
   * `APPROVAL_UNIMPLEMENTED` so the UI surfaces the limitation
   * honestly instead of pretending the response went through.
   */
  approvalResponder: ApprovalResponder;
  /**
   * Phase 13 — persist-and-broadcast pipeline. Used to append
   * canonical `approval.resolved` / `approval.failed` events through
   * the same persist-before-broadcast path that SDK events take, so
   * replay sees the same outcome.
   */
  pipeline: {
    /**
     * Append a synthetic canonical event whose origin is NOT an SDK
     * message. The harness owns the (sdkType, kind, payload) tuple;
     * the pipeline handles the seq allocation + bus publish.
     */
    appendCanonicalEvent: (args: {
      runId: string;
      agentId: string;
      sdkType: "request";
      kind: "approval.resolved" | "approval.failed";
      requestId: string;
      payload: unknown;
      occurredAt: string;
    }) => void;
  };
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
  /**
   * The set of heartbeat ids the server has sent but not yet seen
   * acked. A heartbeat_ack from the client must reference one of
   * these; un-recognised ids are ignored so a buggy client sending a
   * stale or guessed id can't masquerade as a live pong. Bounded by
   * MAX_PENDING_HEARTBEATS so a non-responsive peer doesn't grow the
   * set indefinitely before the missed-pong timeout fires.
   */
  pendingHeartbeatIds: Set<string>;
  /** Heartbeat interval timer; cleared on close. */
  heartbeatTimer: NodeJS.Timeout;
  /**
   * Dedupe map for inbound client frame IDs (spec §4 "Backend
   * rules"). Map<id, insertedAtMs> — evicted by both age
   * (DEDUPE_TTL_MS) and size (DEDUPE_MAX_ENTRIES).
   */
  recentFrameIds: Map<string, number>;
  closed: boolean;
}

interface RunSubscription {
  /** Returns true while replay is still flushing; false once live. */
  replaying: boolean;
  /**
   * Set to true by any code path that decides the subscription is
   * over (backlog overflow, explicit unsubscribe arriving mid-replay,
   * etc.). The listener checks at entry, runReplay checks after each
   * page, and the post-replay drain+ack checks before sending the
   * ack. This prevents (a) sending both an error AND a
   * replay_complete ack for the same subscribe frame and (b) the
   * already-snapshot bus listener delivering more queued events after
   * unsubscribe.
   */
  aborted: boolean;
  /** Live events queued during replay; flushed when replay completes. */
  liveQueue: EventRow[];
  unsubscribe: () => void;
}

/**
 * RV2-C2: per-plugin-instance set of (runId, requestId) approval keys
 * currently in flight through `handleApprovalResponse`. Two
 * `approval_response` frames for the same request — coming in from
 * the same socket, different sockets, or different tabs — race past
 * `findPendingRequest` (which reads from SQLite, not from this set)
 * unless we explicitly serialize them here. Without this guard the
 * responder would be invoked twice and two outcome events would
 * land in the log.
 *
 * Module-scoped Set is fine for a single-user local harness: scope
 * is the buildApp lifetime, the key space is bounded by pending
 * request IDs (single digit per run), and the finally-cleanup runs
 * synchronously after `appendCanonicalEvent`'s commit (which makes
 * `findPendingRequest` see the outcome row immediately).
 */
const inflightApprovals = new Set<string>();

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
  // Clamp ping interval to a sane floor — a 0 or negative value would
  // turn setInterval(fn, 0) into a busy loop. 50ms is the lowest
  // anyone could plausibly want for an integration test; production
  // defaults to 15s. Same lower bound on the missed-pong timeout
  // because a too-tight value would close every connection
  // immediately after the first heartbeat round-trip.
  const pingMs = Math.max(50, opts.heartbeatIntervalMs ?? DEFAULT_PING_INTERVAL_MS);
  const missedMs = Math.max(
    pingMs * 2,
    opts.missedPongTimeoutMs ?? DEFAULT_MISSED_PONG_TIMEOUT_MS,
  );
  const state: ConnectionState = {
    socket,
    log,
    subscriptions: new Map(),
    lastPongAt: Date.now(),
    pendingHeartbeatIds: new Set(),
    heartbeatTimer: setInterval(() => {
      runHeartbeatTick(state, missedMs);
    }, pingMs),
    recentFrameIds: new Map(),
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
  // Explicit clears below are belt-and-braces — GC reclaims the state
  // object anyway. Worth keeping in case a future refactor pools
  // ConnectionState across reconnects (or runs into a leak that this
  // makes easier to diagnose).
  state.recentFrameIds.clear();
  state.pendingHeartbeatIds.clear();
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
  // Record the heartbeat id so the inbound ack handler can verify the
  // client is acking a heartbeat we actually sent (defensive against
  // client bugs that fabricate ids). Bounded eviction: if we've
  // already accumulated MAX_PENDING_HEARTBEATS without acks, evict the
  // oldest (FIFO via Set insertion order) — the missed-pong timeout
  // will close the socket regardless.
  state.pendingHeartbeatIds.add(id);
  if (state.pendingHeartbeatIds.size > MAX_PENDING_HEARTBEATS) {
    const oldest = state.pendingHeartbeatIds.values().next().value;
    if (oldest !== undefined) state.pendingHeartbeatIds.delete(oldest);
  }
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
    const ackId = extractValidFrameIdFromUnknown(raw);
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
  // connection." Tracks insertion timestamps so we can evict by age
  // AND size; a size-only Set would collapse the window under burst.
  // heartbeat_ack is exempt because the same id never repeats.
  if (frame.type !== "heartbeat_ack") {
    pruneRecentFrameIds(state);
    if (state.recentFrameIds.has(frame.id)) {
      sendFrame(
        state,
        ackFrame(frame.id, { message: "duplicate frame id; idempotent reply" }),
      );
      return;
    }
    state.recentFrameIds.set(frame.id, Date.now());
  }

  switch (frame.type) {
    case "heartbeat_ack":
      // Only reset the liveness clock if the ack references a
      // heartbeat we actually sent. Drops fabricated/replayed ids on
      // the floor — silently is fine, the heartbeat watcher will
      // close the socket if the real beats stop arriving.
      if (state.pendingHeartbeatIds.delete(frame.server_heartbeat_id)) {
        state.lastPongAt = Date.now();
      }
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
      void handleApprovalResponse(state, frame, opts);
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
  const existing = state.subscriptions.get(frame.run_id);
  if (existing) {
    // Re-subscribe over the same run. Reject rather than silently
    // re-replaying: the existing subscription may have queued live
    // events (still in `liveQueue` while `replaying === true`); the
    // second replay reads SQLite directly with the new cursor and
    // would leak those queued events past the boundary, producing
    // out-of-seq frames. The client's expected pattern is
    // unsubscribe → subscribe; an in-place resubscribe is a client
    // bug we don't try to paper over.
    sendFrame(
      state,
      errorFrame(
        "VALIDATION_ERROR",
        "Already subscribed to this run; send unsubscribe_run before re-subscribing",
        { ack_for: frame.id },
      ),
    );
    return;
  }

  // Open the subscription FIRST so any event published mid-replay is queued
  // and won't be lost in the gap between snapshot read and live attach.
  const subscription: RunSubscription = {
    replaying: true,
    aborted: false,
    liveQueue: [],
    unsubscribe: () => {
      // populated below
    },
  };
  const unsubscribe = opts.bus.subscribe(frame.run_id, (event) => {
    if (state.closed || subscription.aborted) return;
    if (subscription.replaying) {
      subscription.liveQueue.push(event);
      if (subscription.liveQueue.length > MAX_LIVE_BACKLOG) {
        // Backpressure trigger — close THIS subscription only with
        // `retryable: true` so the client resyncs from SQLite. Mark
        // aborted so the post-replay drain + replay_complete ack at
        // the bottom of this function bail out (otherwise we'd send
        // contradictory error + ack frames for the same subscribe).
        subscription.aborted = true;
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

  // If the listener tripped the backlog guard mid-replay, the error
  // frame has already gone out — don't follow it with a contradictory
  // replay_complete ack and don't drain the abandoned queue.
  if (subscription.aborted) return;

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
    if (last.seq <= cursor) {
      // Unreachable today — the query is `seq > cursor ORDER BY seq
      // ASC`, so `last.seq > cursor` is a SQL invariant. If we ever
      // see this, the schema or the query changed in a way that
      // would silently truncate replay; log loudly and bail rather
      // than infinite-loop on stuck pagination.
      state.log.error(
        { runId, cursor, lastSeq: last.seq, pageSize: rows.length },
        "ws: replay pagination produced a non-advancing cursor — schema regression?",
      );
      return;
    }
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

async function handleApprovalResponse(
  state: ConnectionState,
  frame: Extract<ClientFrame, { type: "approval_response" }>,
  opts: WsPluginOptions,
): Promise<void> {
  // Phase 13 wiring. Approval is resolved through the configured
  // `ApprovalResponder`; OQ-10 unverified means the default responder
  // throws `UnimplementedApprovalError`, and the harness emits
  // `approval.failed` with code `APPROVAL_UNIMPLEMENTED` so the UI is
  // honest. Persist-before-broadcast: the synthetic canonical event
  // lands in `events` BEFORE the WS ack/error goes out.
  // RV2-C2: serialize per-(runId, requestId). The SQLite lookup
  // below sees "still pending" until our outcome row commits, so two
  // concurrent frames would both pass it and double-resolve. Hold
  // the inflight key until persist completes; the finally below
  // releases it.
  const inflightKey = `${frame.run_id}::${frame.request_id}`;
  if (inflightApprovals.has(inflightKey)) {
    sendFrame(
      state,
      errorFrame(
        "APPROVAL_NOT_PENDING",
        `Approval for request_id=${frame.request_id} is already in flight`,
        { ack_for: frame.id },
      ),
    );
    return;
  }
  const pending = findPendingRequest(opts, frame.run_id, frame.request_id);
  if (!pending) {
    sendFrame(
      state,
      errorFrame(
        "APPROVAL_NOT_PENDING",
        `No pending request_id=${frame.request_id} on run_id=${frame.run_id}`,
        { ack_for: frame.id },
      ),
    );
    return;
  }
  const agentId = pending.agentId;
  const input: ApprovalResolveInput = {
    runId: frame.run_id,
    requestId: frame.request_id,
    decision: frame.decision,
    ...(frame.reason !== undefined ? { reason: frame.reason } : {}),
  };
  inflightApprovals.add(inflightKey);
  try {
    await opts.approvalResponder.resolve(input);
    // RV2-C1 + W5: one ISO timestamp per branch shared between
    // occurredAt and resolved_at so the canonical event is self-
    // consistent. Persist BEFORE ack — if the insert throws, the
    // catch below converts it to an INTERNAL_ERROR frame so the
    // client never sees ack-ok on a failed persist.
    try {
      const now = new Date().toISOString();
      opts.pipeline.appendCanonicalEvent({
        runId: frame.run_id,
        agentId,
        sdkType: "request",
        kind: "approval.resolved",
        requestId: frame.request_id,
        payload: {
          request_id: frame.request_id,
          decision: frame.decision,
          ...(frame.reason !== undefined ? { reason: frame.reason } : {}),
          resolved_at: now,
        },
        occurredAt: now,
      });
    } catch (persistErr) {
      state.log.error(
        { err: persistErr, runId: frame.run_id, requestId: frame.request_id },
        "approval.resolved persist failed; refusing to ack client",
      );
      sendFrame(
        state,
        errorFrame(
          "INTERNAL_ERROR",
          "Failed to persist approval outcome",
          { ack_for: frame.id },
        ),
      );
      return;
    }
    sendFrame(state, ackFrame(frame.id, { message: "approval.resolved" }));
  } catch (err) {
    const isUnimplemented = err instanceof UnimplementedApprovalError;
    const code = isUnimplemented ? "APPROVAL_UNIMPLEMENTED" : "SDK_ERROR";
    const message =
      err instanceof Error
        ? err.message
        : "Approval responder rejected without a message";
    try {
      const now = new Date().toISOString();
      opts.pipeline.appendCanonicalEvent({
        runId: frame.run_id,
        agentId,
        sdkType: "request",
        kind: "approval.failed",
        requestId: frame.request_id,
        payload: {
          request_id: frame.request_id,
          decision: frame.decision,
          ...(frame.reason !== undefined ? { reason: frame.reason } : {}),
          failed_at: now,
          code,
          message,
        },
        occurredAt: now,
      });
    } catch (persistErr) {
      state.log.error(
        { err: persistErr, runId: frame.run_id, requestId: frame.request_id },
        "approval.failed persist failed; sending INTERNAL_ERROR instead",
      );
      sendFrame(
        state,
        errorFrame(
          "INTERNAL_ERROR",
          "Failed to persist approval outcome",
          { ack_for: frame.id },
        ),
      );
      return;
    }
    sendFrame(state, errorFrame(code, message, { ack_for: frame.id }));
  } finally {
    // RV2-C2: release the per-(runId, requestId) inflight key. By
    // this point the outcome event has either committed (so a
    // re-issue will see hasOutcome === true via findPendingRequest)
    // or it failed and the client received INTERNAL_ERROR. Either
    // way, the next attempt is safe to admit.
    inflightApprovals.delete(inflightKey);
  }
}

/**
 * Find the pending `request.created` event for a (runId, requestId).
 * Returns the agentId so the synthetic outcome event can be appended
 * with the correct foreign key. A `null` result means no matching
 * request exists, which the WS plugin maps to `APPROVAL_NOT_PENDING`.
 */
function findPendingRequest(
  opts: WsPluginOptions,
  runId: string,
  requestId: string,
): { agentId: string } | null {
  const run = opts.runs.getById(runId);
  if (!run) return null;
  // Walk the run's events for a matching `request.created`. This is a
  // small scan in practice — runs have at most a handful of pending
  // requests at once — and avoids adding a dedicated query path. If a
  // later phase grows pending requests, switch to an indexed lookup.
  const rows = opts.events.getAllByRunId(runId);
  for (const row of rows) {
    if (row.kind === "request.created" && row.requestId === requestId) {
      // Confirm this request hasn't already been resolved / failed.
      const alreadyDone = rows.some(
        (r) =>
          r.requestId === requestId &&
          (r.kind === "approval.resolved" || r.kind === "approval.failed"),
      );
      if (alreadyDone) return null;
      return { agentId: row.agentId };
    }
  }
  return null;
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

/**
 * Amortized eviction for the dedupe map. Called once per inbound
 * frame; drops entries older than DEDUPE_TTL_MS first, then trims to
 * DEDUPE_MAX_ENTRIES if still over capacity. Map preserves insertion
 * order, so the first key is always the oldest.
 */
function pruneRecentFrameIds(state: ConnectionState): void {
  const now = Date.now();
  const cutoff = now - DEDUPE_TTL_MS;
  for (const [id, insertedAt] of state.recentFrameIds) {
    if (insertedAt > cutoff) break; // ordered by insertion → first newer ⇒ all rest newer
    state.recentFrameIds.delete(id);
  }
  while (state.recentFrameIds.size > DEDUPE_MAX_ENTRIES) {
    const first = state.recentFrameIds.keys().next().value;
    if (first === undefined) break;
    state.recentFrameIds.delete(first);
  }
}

/**
 * Pull `id` off an unknown payload but ONLY return it if it would pass
 * `frameIdSchema` (string, length 8..128). Used when building the
 * VALIDATION_ERROR reply for a frame that already failed parsing — we
 * want to include `ack_for` when possible so the client can correlate,
 * but a pathological id (empty, too short, too long, non-string) would
 * itself make our outbound errorFrame schema-invalid.
 */
function extractValidFrameIdFromUnknown(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const id = (raw as { id?: unknown }).id;
  if (typeof id !== "string") return undefined;
  const parsed = frameIdSchema.safeParse(id);
  return parsed.success ? parsed.data : undefined;
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
