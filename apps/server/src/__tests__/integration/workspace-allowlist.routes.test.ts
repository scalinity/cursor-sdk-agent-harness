import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { loadEnv } from "../../config/env.js";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { CsrfSecretStore, CursorApiKeyStore } from "../../keychain/index.js";
import {
  createInMemoryKeychainDriver,
  resetKeychainDriverForTests,
  setKeychainDriver,
} from "../../keychain/testing.js";

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
  csrfToken: string;
  tmpRoot: string;
  close: () => Promise<void>;
}

async function build(): Promise<Harness> {
  const env = loadEnv(BASE_ENV);
  const dbClient = openTestDb();
  const repos = createRepositories(dbClient.raw);
  const { app } = await buildApp({
    env,
    repos,
    apiKeyStore: new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE }),
    csrfSecretStore: new CsrfSecretStore({ service: env.KEYCHAIN_SERVICE }),
  });
  const tokenRes = await app.inject({
    method: "GET",
    url: "/api/security/csrf-token",
    headers: { origin: "http://127.0.0.1:5173" },
  });
  const csrfToken = (tokenRes.json() as { token: string }).token;
  const tmpRoot = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "harness-wa-")),
  );
  return {
    app,
    csrfToken,
    tmpRoot,
    close: async () => {
      await app.close();
      dbClient.raw.close();
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    },
  };
}

describe("workspace-allowlist routes", () => {
  let h: Harness;

  beforeEach(() => {
    setKeychainDriver(createInMemoryKeychainDriver());
  });

  afterEach(async () => {
    await h?.close();
    resetKeychainDriverForTests();
  });

  it("rejects symlink-escape paths from POST /validate", async () => {
    h = await build();
    const allowed = path.join(h.tmpRoot, "allowed");
    const forbidden = path.join(h.tmpRoot, "forbidden");
    await fs.mkdir(allowed);
    await fs.mkdir(forbidden);
    const escape = path.join(allowed, "escape");
    await fs.symlink(forbidden, escape);

    const res = await h.app.inject({
      method: "POST",
      url: "/api/workspace-allowlist/validate",
      payload: { path: escape },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": h.csrfToken,
        "content-type": "application/json",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      allowed: false,
      reason: "symlink_escape",
    });
  });

  it("creates, lists, and deletes allowlist entries", async () => {
    h = await build();
    const dir = path.join(h.tmpRoot, "myproj");
    await fs.mkdir(dir);

    const create = await h.app.inject({
      method: "POST",
      url: "/api/workspace-allowlist",
      payload: { path: dir, recursive: true },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": h.csrfToken,
        "content-type": "application/json",
      },
    });
    expect(create.statusCode).toBe(201);
    const entry = create.json() as { id: string; path: string };
    expect(entry.path).toBe(dir);

    const list = await h.app.inject({
      method: "GET",
      url: "/api/workspace-allowlist",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items).toHaveLength(1);

    // Delete without confirm → 409.
    const tryDelete = await h.app.inject({
      method: "DELETE",
      url: `/api/workspace-allowlist/${entry.id}`,
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": h.csrfToken,
      },
    });
    expect(tryDelete.statusCode).toBe(409);
    expect(tryDelete.json()).toMatchObject({ code: "CONFIRM_REQUIRED" });

    const confirmedDelete = await h.app.inject({
      method: "DELETE",
      url: `/api/workspace-allowlist/${entry.id}?confirm=true`,
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": h.csrfToken,
      },
    });
    expect(confirmedDelete.statusCode).toBe(204);
  });

  it("POST refuses a nonexistent path", async () => {
    h = await build();
    const res = await h.app.inject({
      method: "POST",
      url: "/api/workspace-allowlist",
      payload: { path: path.join(h.tmpRoot, "ghost") },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": h.csrfToken,
        "content-type": "application/json",
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "PATH_MISSING" });
  });
});
