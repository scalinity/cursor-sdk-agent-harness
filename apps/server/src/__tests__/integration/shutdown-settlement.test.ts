import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { buildApp } from "../../app.js";
import { loadEnv } from "../../config/env.js";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { CsrfSecretStore, CursorApiKeyStore } from "../../keychain/index.js";
import { createStubSdkAdapter } from "../../sdk/testing.js";

const BASE_ENV: NodeJS.ProcessEnv = {
  HOST: "127.0.0.1",
  PORT: "4783",
  WEB_ORIGIN: "http://127.0.0.1:5173",
  LOG_LEVEL: "error",
  KEYCHAIN_SERVICE: "cursor-sdk-agent-harness-test",
  ALLOW_REMOTE_BIND: "false",
  HARNESS_SHUTDOWN_GRACE_MS: "3000",
};

describe("agent runtime shutdown settlement", () => {
  let tmpDir: string;
  let closeApp: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closeApp) {
      await closeApp();
      closeApp = null;
    }
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  it("awaits active run settlement so the run row is terminal after shutdown (CA-P25-C4)", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-shutdown-"));
    const allowedDir = path.join(tmpDir, "ws");
    await fs.mkdir(allowedDir);
    const realAllowed = await fs.realpath(allowedDir);

    const env = loadEnv(BASE_ENV);
    const dbClient = openTestDb();
    const repos = createRepositories(dbClient.raw);
    repos.workspaceAllowlist.create({ path: realAllowed, recursive: true });

    const apiKeyStore = new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE });
    await apiKeyStore.setApiKey("sk-test-12345678");

    const sdk = createStubSdkAdapter({
      onSend: ({ agent, idempotencyKey }) => ({
        runId: idempotencyKey ?? "stub-run",
        agentId: agent.agentId,
        holdStreamAfterEvents: true,
        events: [
          {
            type: "status",
            agent_id: agent.agentId,
            run_id: idempotencyKey,
            status: "RUNNING",
          },
        ],
        finalResult: { status: "finished", durationMs: 5 },
      }),
    });

    const built = await buildApp({
      env,
      repos,
      apiKeyStore,
      csrfSecretStore: new CsrfSecretStore({ service: env.KEYCHAIN_SERVICE }),
      sdk,
      skipStartupRecovery: true,
    });
    await built.app.listen({ host: "127.0.0.1", port: 0 });
    const port = (built.app.server.address() as AddressInfo).port;

    closeApp = async () => {
      await built.app.close();
      dbClient.raw.close();
    };

    const csrfRes = await built.app.inject({
      method: "GET",
      url: "/api/security/csrf-token",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    const csrf = (csrfRes.json() as { token: string }).token;

    const agentRes = await built.app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "shutdown test",
        mode: "local",
        modelId: "composer-2-5-fast",
        cwd: [realAllowed],
        sandboxEnabled: true,
        settingSources: ["project"],
        mcpServerIds: [],
        subagentDefinitionIds: [],
      },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
    });
    expect(agentRes.statusCode).toBe(201);
    const agentId = (agentRes.json() as { id: string }).id;

    const runRes = await built.app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { agentId, prompt: "hold" },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
    });
    expect(runRes.statusCode).toBe(201);
    const runId = (runRes.json() as { runId: string }).runId;

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const row = repos.runs.getById(runId);
      if (row?.status === "RUNNING") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(repos.runs.getById(runId)?.status).toBe("RUNNING");

    await built.agentRuntime.shutdown();

    const row = repos.runs.getById(runId);
    expect(row?.status).not.toBe("RUNNING");
    expect(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]).toContain(row?.status);
    expect(built.activeRuns.size()).toBe(0);

    await built.app.close();
    closeApp = null;
    dbClient.raw.close();
  }, 10_000);
});
