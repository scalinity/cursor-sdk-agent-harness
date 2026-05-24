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

  // Regression — re-POSTing an already-allowlisted path used to fail with
  // SQLITE_CONSTRAINT_UNIQUE (500), which short-circuited the picker before
  // `setActive` fired and left the titlebar stuck on "Pick workspace…".
  // Now the route is idempotent on path: existing rows return 200 with the
  // canonical entry, and the picker can proceed to `setActive`.
  it("POST is idempotent on path: existing row returns 200 with same id", async () => {
    h = await build();
    const dir = path.join(h.tmpRoot, "reused");
    await fs.mkdir(dir);

    const first = await h.app.inject({
      method: "POST",
      url: "/api/workspace-allowlist",
      payload: { path: dir, recursive: true },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": h.csrfToken,
        "content-type": "application/json",
      },
    });
    expect(first.statusCode).toBe(201);
    const firstRow = first.json() as { id: string; path: string };

    const second = await h.app.inject({
      method: "POST",
      url: "/api/workspace-allowlist",
      payload: { path: dir, recursive: true },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": h.csrfToken,
        "content-type": "application/json",
      },
    });
    expect(second.statusCode).toBe(200);
    const secondRow = second.json() as { id: string; path: string };
    expect(secondRow.id).toBe(firstRow.id);
    expect(secondRow.path).toBe(firstRow.path);

    // And there's still only one row in the table.
    const list = await h.app.inject({
      method: "GET",
      url: "/api/workspace-allowlist",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect((list.json() as { items: unknown[] }).items).toHaveLength(1);
  });

  it("active workspace: GET defaults to null, PUT sets, PUT null clears", async () => {
    h = await build();

    // Initially unset.
    const empty = await h.app.inject({
      method: "GET",
      url: "/api/workspace-allowlist/active",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({
      activeWorkspaceId: null,
      workspace: null,
    });

    // Create an allowlist entry, then promote it to active.
    const dir = path.join(h.tmpRoot, "active-proj");
    await fs.mkdir(dir);
    const created = await h.app.inject({
      method: "POST",
      url: "/api/workspace-allowlist",
      payload: { path: dir, recursive: true },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": h.csrfToken,
        "content-type": "application/json",
      },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };

    const setActive = await h.app.inject({
      method: "PUT",
      url: "/api/workspace-allowlist/active",
      payload: { id },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": h.csrfToken,
        "content-type": "application/json",
      },
    });
    expect(setActive.statusCode).toBe(200);
    const setBody = setActive.json() as { activeWorkspaceId: string };
    expect(setBody.activeWorkspaceId).toBe(id);

    const readBack = await h.app.inject({
      method: "GET",
      url: "/api/workspace-allowlist/active",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(readBack.statusCode).toBe(200);
    expect((readBack.json() as { activeWorkspaceId: string }).activeWorkspaceId).toBe(id);

    // Clear by sending null.
    const clear = await h.app.inject({
      method: "PUT",
      url: "/api/workspace-allowlist/active",
      payload: { id: null },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": h.csrfToken,
        "content-type": "application/json",
      },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json()).toMatchObject({ activeWorkspaceId: null });
  });

  it("active workspace: PUT with unknown id returns 404", async () => {
    h = await build();
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/workspace-allowlist/active",
      payload: { id: "does-not-exist" },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": h.csrfToken,
        "content-type": "application/json",
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("R17-W2: deleting the active workspace clears the active pointer", async () => {
    h = await build();

    const dir = path.join(h.tmpRoot, "to-delete-proj");
    await fs.mkdir(dir);
    const created = await h.app.inject({
      method: "POST",
      url: "/api/workspace-allowlist",
      payload: { path: dir, recursive: true },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": h.csrfToken,
        "content-type": "application/json",
      },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };

    const setActive = await h.app.inject({
      method: "PUT",
      url: "/api/workspace-allowlist/active",
      payload: { id },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": h.csrfToken,
        "content-type": "application/json",
      },
    });
    expect(setActive.statusCode).toBe(200);

    // Delete the active entry.
    const del = await h.app.inject({
      method: "DELETE",
      url: `/api/workspace-allowlist/${id}?confirm=true`,
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": h.csrfToken,
      },
    });
    expect(del.statusCode).toBe(204);

    // The active pointer must NOT dangle at the deleted id.
    const after = await h.app.inject({
      method: "GET",
      url: "/api/workspace-allowlist/active",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({ activeWorkspaceId: null, workspace: null });
  });
});
