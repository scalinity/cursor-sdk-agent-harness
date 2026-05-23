import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { registerRoutes } from "./routes/index.js";
import type { Env } from "./config/env.js";
import { REDACT_CONFIG, safeReqSerializer } from "./observability/logger.js";
import { createPerfCounters, type PerfCounters } from "./observability/perf-counters.js";
import {
  CursorApiKeyStore,
  CsrfSecretStore,
} from "./keychain/index.js";
import { assertBindAllowed } from "./security/bind-policy.js";
import { CsrfTokenizer, csrfPlugin } from "./security/csrf.js";
import { originPolicyPlugin } from "./security/origin-policy.js";
import { WorkspacePolicy } from "./security/workspace-policy.js";
import type { Repositories } from "./db/repositories/index.js";
import {
  ActiveRuns,
  buildApprovalResponder,
  createAgentRuntime,
  createCursorSdkAdapter,
  createPersistAndBroadcast,
  runStartupRecovery,
  type AgentRuntime,
  type ApprovalResponder,
  type SdkAdapter,
} from "./sdk/index.js";
import { createRunBus, wsPlugin, type RunBus } from "./ws/index.js";

export interface AppDeps {
  env: Env;
  repos: Repositories;
  /**
   * Pre-built dependencies. If a field is omitted, `buildApp` will construct
   * the production default (Keychain-backed stores, real tokenizer). Tests
   * inject in-memory variants here.
   */
  apiKeyStore?: CursorApiKeyStore;
  csrfSecretStore?: CsrfSecretStore;
  csrfTokenizer?: CsrfTokenizer;
  workspacePolicy?: WorkspacePolicy;
  /**
   * Phase 06 SDK adapter. Production uses `createCursorSdkAdapter()` (the
   * default when omitted). Integration tests inject a stubbed adapter that
   * synthesises SDK events without touching the network or the real API key.
   */
  sdk?: SdkAdapter;
  /**
   * Optional WS heartbeat overrides. Integration tests pass a small value
   * (e.g. 50ms) so they don't need to wait the production 15s cadence to
   * observe a heartbeat.
   */
  wsHeartbeatIntervalMs?: number;
  wsMissedPongTimeoutMs?: number;
  /**
   * Phase 13 — injected approval responder. Tests provide a stub
   * that resolves successfully or throws `UnimplementedApprovalError`
   * deterministically. Production defaults to the probe-based
   * responder, which throws `UnimplementedApprovalError` against
   * `@cursor/sdk@1.0.13` (OQ-10 unresolved).
   */
  approvalResponder?: ApprovalResponder;
  /**
   * Phase 13 — skip startup recovery. Most tests want the default
   * (recovery runs); the few that pre-seed RUNNING rows AND want to
   * inspect them before recovery flips them set this to true.
   */
  skipStartupRecovery?: boolean;
  /**
   * Phase 14 — injected perf counters. Production builds a real
   * recorder via `createPerfCounters()` so the
   * `/api/observability/perf` route can surface live histograms.
   * Tests may pass a shared instance to assert observation behavior.
   */
  perfCounters?: PerfCounters;
}

export interface BuiltApp {
  app: FastifyInstance;
  apiKeyStore: CursorApiKeyStore;
  csrfTokenizer: CsrfTokenizer;
  workspacePolicy: WorkspacePolicy;
  agentRuntime: AgentRuntime;
  /**
   * Phase 07: in-memory pub/sub for committed canonical events. Exposed so
   * tests can subscribe directly to verify persist-before-broadcast
   * semantics without going through a WS socket.
   */
  runBus: RunBus;
  /**
   * Phase 07: registry of currently-active run controllers. Exposed for the
   * same testing reason as runBus and so future REST routes can implement
   * cancellation through a single source of truth.
   */
  activeRuns: ActiveRuns;
  /**
   * Phase 14 — exposed so tests can assert observation behaviour and the
   * `/api/observability/perf` route can read live snapshots.
   */
  perfCounters: PerfCounters;
}

export async function buildApp(deps: AppDeps): Promise<BuiltApp> {
  const { env, repos } = deps;

  // Belt-and-braces: env.ts already rejects non-loopback HOST at parse time,
  // but any future entrypoint that bypasses loadEnv would otherwise reach
  // app.listen unchecked. Hard fail here too.
  assertBindAllowed(env.HOST, env.ALLOW_REMOTE_BIND);

  const apiKeyStore =
    deps.apiKeyStore ?? new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE });
  const csrfSecretStore =
    deps.csrfSecretStore ?? new CsrfSecretStore({ service: env.KEYCHAIN_SERVICE });
  const csrfTokenizer =
    deps.csrfTokenizer ?? new CsrfTokenizer(await csrfSecretStore.getOrCreate());
  const workspacePolicy =
    deps.workspacePolicy ??
    new WorkspacePolicy({ allowlist: repos.workspaceAllowlist });

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: REDACT_CONFIG,
      base: { service: "cursor-sdk-agent-harness" },
      // The default `req` serializer captures `req.url` verbatim,
      // which leaks `?csrf=<token>` on WS upgrades (browsers can't add
      // custom headers to a WS upgrade so the token rides in the
      // query). Replace with one that scrubs the param.
      serializers: { req: safeReqSerializer },
    },
    disableRequestLogging: false,
    trustProxy: false,
  });

  // One-shot CURSOR_API_KEY import. Runs synchronously in onReady so the
  // server doesn't start serving requests until the Keychain state is settled.
  app.addHook("onReady", async () => {
    if (env.CURSOR_API_KEY === undefined) return;
    if (await apiKeyStore.hasApiKey()) {
      app.log.info(
        "CURSOR_API_KEY env var is set but Keychain already has a key. Ignoring env var; unset it to avoid confusion.",
      );
      return;
    }
    await apiKeyStore.setApiKey(env.CURSOR_API_KEY);
    app.log.info(
      "Imported CURSOR_API_KEY into macOS Keychain. You can now unset the env var.",
    );
  });

  await app.register(originPolicyPlugin, { allowedOrigin: env.WEB_ORIGIN });
  await app.register(cors, {
    origin: [env.WEB_ORIGIN],
    credentials: true,
  });
  await app.register(csrfPlugin, {
    tokenizer: csrfTokenizer,
    exemptUrls: ["/api/security/csrf-token"],
  });
  await app.register(websocket);

  // Phase 14 — perf counters live above the pipeline so both the
  // persist-and-broadcast pipeline and the WS plugin share one
  // observation surface.
  const perfCounters = deps.perfCounters ?? createPerfCounters();

  // Phase 07 pipeline. Build the run bus + persist-and-broadcast first so
  // the agent runtime gets the real sink — the stub Phase 06 sink is now
  // dead code outside tests.
  const runBus = createRunBus();
  const activeRuns = new ActiveRuns();
  const pipeline = createPersistAndBroadcast({
    events: repos.events,
    bus: runBus,
    logger: app.log,
    perfCounters,
  });

  const sdk = deps.sdk ?? createCursorSdkAdapter();
  const agentRuntime = createAgentRuntime({
    agentsRepo: repos.agents,
    runsRepo: repos.runs,
    mcpRepo: repos.mcpServers,
    subagentsRepo: repos.subagents,
    settingsRepo: repos.settings,
    workspacePolicy,
    apiKeyStore,
    sdk,
    logger: app.log,
    activeRuns,
    pipeline,
  });

  const approvalResponder =
    deps.approvalResponder ?? buildApprovalResponder({ activeRuns, logger: app.log });

  await app.register(wsPlugin, {
    csrf: csrfTokenizer,
    allowedOrigin: env.WEB_ORIGIN,
    events: repos.events,
    runs: repos.runs,
    bus: runBus,
    activeRuns,
    approvalResponder,
    pipeline,
    perfCounters,
    ...(deps.wsHeartbeatIntervalMs !== undefined
      ? { heartbeatIntervalMs: deps.wsHeartbeatIntervalMs }
      : {}),
    ...(deps.wsMissedPongTimeoutMs !== undefined
      ? { missedPongTimeoutMs: deps.wsMissedPongTimeoutMs }
      : {}),
  });

  // Phase 13 — finalize any runs left RUNNING by a previous process.
  // Append the synthetic `run.interrupted` events BEFORE we accept
  // connections so the first replay sees the truncated timeline.
  if (deps.skipStartupRecovery !== true) {
    app.addHook("onReady", async () => {
      runStartupRecovery({ runs: repos.runs, logger: app.log });
    });
  }

  app.addHook("onClose", async () => {
    await agentRuntime.shutdown();
    runBus.clear();
    pipeline.clear();
  });

  await registerRoutes(app, {
    security: { csrf: csrfTokenizer },
    settings: { settings: repos.settings, apiKeyStore },
    workspaceAllowlist: {
      allowlist: repos.workspaceAllowlist,
      policy: workspacePolicy,
    },
    agents: { runtime: agentRuntime },
    runs: {
      runtime: agentRuntime,
      runsRepo: repos.runs,
      eventsRepo: repos.events,
      agentsRepo: repos.agents,
    },
    events: { events: repos.events },
    usage: { runsRepo: repos.runs, settingsRepo: repos.settings },
    mcpServers: { mcpServers: repos.mcpServers },
    subagents: { subagents: repos.subagents, mcpServers: repos.mcpServers },
    observability: { perfCounters },
  });

  return {
    app,
    apiKeyStore,
    csrfTokenizer,
    workspacePolicy,
    agentRuntime,
    runBus,
    activeRuns,
    perfCounters,
  };
}
