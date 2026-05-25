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
  ProviderKeyStore,
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
import {
  TerminalSession,
  terminalWsPlugin,
  createWorkspaceCwdResolver,
} from "./terminal/index.js";
import { MAX_IMAGE_ATTACHMENTS, MAX_IMAGE_DATA_BYTES } from "@harness/shared";
import { SearchService } from "./search/search-service.js";
import { ModelRouter } from "./providers/model-router.js";

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
   * Phase 23 — semantic search facade (embedder + indexer + watcher).
   * Tests inject one backed by the deterministic FakeEmbedder so the suite
   * never downloads the ONNX model.
   */
  searchService?: SearchService;
  /** Phase 23 — BYOK provider key store + model router (tests may inject). */
  providerKeyStore?: ProviderKeyStore;
  modelRouter?: ModelRouter;
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
  /**
   * Embedded terminal session. Production builds one backed by node-pty.
   * Integration tests inject a `TerminalSession` with a stub `spawnPty` so
   * they exercise the `/ws/terminal` wiring without a real shell.
   */
  terminalSession?: TerminalSession;
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
  /**
   * Embedded terminal session, exposed so tests can drive/inspect it and so
   * the desktop entrypoint could surface session state if needed.
   */
  terminalSession: TerminalSession;
}

export async function buildApp(deps: AppDeps): Promise<BuiltApp> {
  const { env, repos } = deps;

  // Belt-and-braces: env.ts already rejects non-loopback HOST at parse time,
  // but any future entrypoint that bypasses loadEnv would otherwise reach
  // app.listen unchecked. Hard fail here too.
  assertBindAllowed(env.HOST, env.ALLOW_REMOTE_BIND);

  // Phase 16 — when the server is launched by the Electron main process,
  // HARNESS_DESKTOP=1 tells us to accept `app://harness` as a second origin
  // (the prod renderer loads from a custom protocol). Browser-only dev
  // continues to ship with the single env.WEB_ORIGIN entry.
  const HARNESS_APP_ORIGIN = "app://harness";
  // Read from the parsed env, not process.env: the Electron main passes
  // HARNESS_DESKTOP=1 through startServer's envOverrides, which only reach
  // loadEnv — never the real process.env. Reading process.env here left
  // desktopMode false in the packaged app, so app://harness was never
  // allowlisted and every renderer request 403'd.
  const desktopMode = env.HARNESS_DESKTOP;
  const allowedOrigins: string[] = desktopMode
    ? [env.WEB_ORIGIN, HARNESS_APP_ORIGIN]
    : [env.WEB_ORIGIN];

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
    // Explicit body limit (R17-W1): bound the image-attachment ingress on
    // POST /api/runs instead of relying on Fastify's silent ~1 MiB default.
    // Sized for up to 16 images at MAX_IMAGE_DATA_BYTES each + ~4 MiB headroom
    // for the prompt/JSON envelope.
    bodyLimit: MAX_IMAGE_DATA_BYTES * MAX_IMAGE_ATTACHMENTS + 4 * 1024 * 1024,
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

  await app.register(originPolicyPlugin, { allowedOrigins });
  await app.register(cors, {
    origin: allowedOrigins,
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

  // Phase 23 — semantic search facade. Default uses the real WASM embedder;
  // tests inject one backed by the deterministic FakeEmbedder.
  const searchService =
    deps.searchService ??
    new SearchService({
      embeddingsRepo: repos.embeddings,
      indexStatusRepo: repos.indexStatus,
      logger: app.log,
    });

  // Phase 23 — BYOK provider key store + multi-model router.
  const providerKeyStore =
    deps.providerKeyStore ?? new ProviderKeyStore({ service: env.KEYCHAIN_SERVICE });
  const modelRouter =
    deps.modelRouter ?? new ModelRouter({ modelProvidersRepo: repos.modelProviders, providerKeyStore });

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
    allowlistRepo: repos.workspaceAllowlist,
    searchService,
    modelRouter,
  });

  const approvalResponder =
    deps.approvalResponder ?? buildApprovalResponder({ activeRuns, logger: app.log });

  await app.register(wsPlugin, {
    csrf: csrfTokenizer,
    allowedOrigins,
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

  // Embedded terminal — a single long-lived PTY shared over /ws/terminal.
  // Ephemeral I/O: it never touches the persist-and-broadcast pipeline. The
  // shell starts in the active workspace dir (allowlist-resolved), else home.
  const terminalSession =
    deps.terminalSession ??
    new TerminalSession({
      resolveCwd: createWorkspaceCwdResolver({
        settings: repos.settings,
        allowlist: repos.workspaceAllowlist,
      }),
      logger: app.log,
    });
  await app.register(terminalWsPlugin, {
    csrf: csrfTokenizer,
    allowedOrigins,
    session: terminalSession,
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
    terminalSession.dispose();
    searchService.stopWatching();
    runBus.clear();
    pipeline.clear();
  });

  await registerRoutes(app, {
    security: { csrf: csrfTokenizer },
    settings: { settings: repos.settings, apiKeyStore },
    workspaceAllowlist: {
      allowlist: repos.workspaceAllowlist,
      policy: workspacePolicy,
      settings: repos.settings,
      searchService,
    },
    agents: { runtime: agentRuntime, agentsRepo: repos.agents },
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
    git: {
      settingsRepo: repos.settings,
      workspaceAllowlist: repos.workspaceAllowlist,
    },
    files: {
      settingsRepo: repos.settings,
      workspaceAllowlist: repos.workspaceAllowlist,
    },
    context: {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
      docsRepo: repos.docs,
      notepadsRepo: repos.notepads,
      searchService,
    },
    search: {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
      searchService,
    },
    rules: {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
    },
    docs: { docsRepo: repos.docs },
    notepads: { notepadsRepo: repos.notepads },
    commands: { slashCommandsRepo: repos.slashCommands },
    terminalAi: {},
    providers: {
      modelProvidersRepo: repos.modelProviders,
      providerKeyStore,
      modelRouter,
      logger: app.log,
    },
  });

  // Seed built-in slash commands on first install
  repos.slashCommands.seedBuiltins();

  return {
    app,
    apiKeyStore,
    csrfTokenizer,
    workspacePolicy,
    agentRuntime,
    runBus,
    activeRuns,
    perfCounters,
    terminalSession,
  };
}
