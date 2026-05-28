import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer } from "../programmatic.js";
import {
  createInMemoryKeychainDriver,
  resetKeychainDriverForTests,
  setKeychainDriver,
} from "../keychain/testing.js";

const BASE_ENV: NodeJS.ProcessEnv = {
  HOST: "127.0.0.1",
  PORT: "4783",
  WEB_ORIGIN: "http://127.0.0.1:5173",
  LOG_LEVEL: "error",
  KEYCHAIN_SERVICE: "cursor-sdk-agent-harness-programmatic-test",
  ALLOW_REMOTE_BIND: "false",
  HARNESS_DESKTOP: "1",
};

describe("programmatic startServer", () => {
  let tempDir: string | null = null;

  beforeEach(() => {
    setKeychainDriver(createInMemoryKeychainDriver());
  });

  afterEach(async () => {
    resetKeychainDriverForTests();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("can bind an ephemeral desktop server and report the resolved URL", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "harness-programmatic-"));
    const started = await startServer({
      envOverrides: { ...BASE_ENV, DB_PATH: join(tempDir, "harness.sqlite") },
      listenPort: 0,
    });

    try {
      expect(started.port).not.toBe(4783);
      expect(started.url).toBe(`http://127.0.0.1:${started.port}`);

      const res = await fetch(`${started.url}/api/security/csrf-token`, {
        headers: { Origin: "app://harness" },
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toHaveProperty("token");
    } finally {
      await started.close();
    }
  });

  it("boots with a file-backed keychain when HARNESS_KEYCHAIN_DIR is set", async () => {
    resetKeychainDriverForTests();
    tempDir = await mkdtemp(join(tmpdir(), "harness-programmatic-file-keychain-"));
    const started = await startServer({
      envOverrides: {
        ...BASE_ENV,
        DB_PATH: join(tempDir, "harness.sqlite"),
        HARNESS_KEYCHAIN_DIR: join(tempDir, "keychain"),
        HARNESS_DESKTOP: "0",
        WEB_ORIGIN: "http://127.0.0.1:5173",
      },
      listenPort: 0,
    });

    try {
      const res = await fetch(`${started.url}/api/security/csrf-token`, {
        headers: { Origin: "http://127.0.0.1:5173" },
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toHaveProperty("token");
    } finally {
      await started.close();
    }
  });
});
