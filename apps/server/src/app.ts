import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { registerRoutes } from "./routes/index.js";
import type { Env } from "./config/env.js";
import { REDACT_CONFIG } from "./observability/logger.js";
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
  createAgentRuntime,
  createCursorSdkAdapter,
  type AgentRuntime,
  type SdkAdapter,
} from "./sdk/index.js";

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
}

export interface BuiltApp {
  app: FastifyInstance;
  apiKeyStore: CursorApiKeyStore;
  csrfTokenizer: CsrfTokenizer;
  workspacePolicy: WorkspacePolicy;
  agentRuntime: AgentRuntime;
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
  });

  app.addHook("onClose", async () => {
    await agentRuntime.shutdown();
  });

  await registerRoutes(app, {
    security: { csrf: csrfTokenizer },
    settings: { settings: repos.settings, apiKeyStore },
    workspaceAllowlist: {
      allowlist: repos.workspaceAllowlist,
      policy: workspacePolicy,
    },
    agents: { runtime: agentRuntime },
    runs: { runtime: agentRuntime, runsRepo: repos.runs },
  });

  return { app, apiKeyStore, csrfTokenizer, workspacePolicy, agentRuntime };
}
