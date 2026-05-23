/**
 * Phase 12 integration — verifies the end-to-end create-agent flow honors
 * the spec §5 "disabled MCP / subagent excluded from Agent.create" rule.
 *
 * The stub SDK adapter captures `AgentOptions` at create time; we assert
 * on the captured object directly rather than poking at the runtime
 * internals, so the assertion travels with the public seam (and breaks
 * if a future refactor accidentally pipes disabled rows into the SDK).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentOptions } from "@cursor/sdk";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { loadEnv } from "../../config/env.js";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories, type Repositories } from "../../db/repositories/index.js";
import { CursorApiKeyStore } from "../../keychain/index.js";
import {
  createInMemoryKeychainDriver,
  resetKeychainDriverForTests,
  setKeychainDriver,
} from "../../keychain/testing.js";
import { createStubSdkAdapter } from "../../sdk/testing.js";

const BASE_ENV: NodeJS.ProcessEnv = {
  HOST: "127.0.0.1",
  PORT: "4783",
  WEB_ORIGIN: "http://127.0.0.1:5173",
  LOG_LEVEL: "error",
  KEYCHAIN_SERVICE: "cursor-sdk-agent-harness-test",
  ALLOW_REMOTE_BIND: "false",
};

interface Harness {
  app: FastifyInstance;
  close: () => Promise<void>;
  allowedDir: string;
  tmpDir: string;
  repos: Repositories;
  csrfToken: () => Promise<string>;
  capturedOptions: AgentOptions[];
}

async function buildHarness(): Promise<Harness> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-am-"));
  const allowedDir = path.join(tmpDir, "ws");
  await fs.mkdir(allowedDir);
  const realAllowed = await fs.realpath(allowedDir);

  const env = loadEnv(BASE_ENV);
  const dbClient = openTestDb();
  const repos = createRepositories(dbClient.raw);
  repos.workspaceAllowlist.create({ path: realAllowed, recursive: true });

  const apiKeyStore = new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE });
  await apiKeyStore.setApiKey("sk-test-12345678");

  const capturedOptions: AgentOptions[] = [];
  const sdk = createStubSdkAdapter({
    onCreate: (opts) => {
      capturedOptions.push(opts);
    },
  });

  const { app, csrfTokenizer } = await buildApp({
    env,
    repos,
    apiKeyStore,
    sdk,
  });

  return {
    app,
    close: async () => {
      await app.close();
      dbClient.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
    allowedDir: realAllowed,
    tmpDir,
    repos,
    csrfToken: async () => csrfTokenizer.issue(),
    capturedOptions,
  };
}

describe("Phase 12 — agent create wiring", () => {
  let h: Harness | null = null;

  beforeEach(() => {
    setKeychainDriver(createInMemoryKeychainDriver());
  });

  afterEach(async () => {
    await h?.close();
    h = null;
    resetKeychainDriverForTests();
    vi.restoreAllMocks();
  });

  it("excludes disabled MCP servers from AgentOptions.mcpServers", async () => {
    h = await buildHarness();
    const enabled = h.repos.mcpServers.create({
      name: "enabled-srv",
      enabled: true,
      config: { command: "/bin/echo" },
    });
    // Bump to valid so the builder picks it up.
    h.repos.mcpServers.update(enabled.id, { validationStatus: "valid" });
    const disabled = h.repos.mcpServers.create({
      name: "disabled-srv",
      enabled: false,
      config: { command: "/bin/echo" },
    });
    h.repos.mcpServers.update(disabled.id, { validationStatus: "valid" });

    const token = await h.csrfToken();
    const res = await h.app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "with-mcp",
        mode: "local",
        modelId: "composer-2-5-fast",
        cwd: [h.allowedDir],
        sandboxEnabled: true,
        settingSources: ["project"],
        mcpServerIds: [enabled.id, disabled.id],
        subagentDefinitionIds: [],
      },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(h.capturedOptions).toHaveLength(1);
    const opts = h.capturedOptions[0]!;
    expect(opts.mcpServers).toBeDefined();
    expect(Object.keys(opts.mcpServers ?? {})).toEqual(["enabled-srv"]);
  });

  it("excludes disabled subagents and omits model when inherit", async () => {
    h = await buildHarness();
    const enabledSub = h.repos.subagents.create({
      name: "active-sub",
      enabled: true,
      description: "active",
      prompt: "do work",
      model: null, // inherit
    });
    h.repos.subagents.create({
      name: "off-sub",
      enabled: false,
      description: "off",
      prompt: "do nothing",
      model: { id: "composer-2-5" },
    });
    void enabledSub;

    const token = await h.csrfToken();
    const res = await h.app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "with-subs",
        mode: "local",
        modelId: "composer-2-5-fast",
        cwd: [h.allowedDir],
        sandboxEnabled: true,
        settingSources: ["project"],
        mcpServerIds: [],
        subagentDefinitionIds: [],
      },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    expect(res.statusCode).toBe(201);
    const opts = h.capturedOptions[0]!;
    expect(opts.agents).toBeDefined();
    expect(Object.keys(opts.agents ?? {})).toEqual(["active-sub"]);
    // Inherit → model field is omitted, not set to null.
    expect(opts.agents?.["active-sub"]?.model).toBeUndefined();
  });
});
