import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("CURSOR_API_KEY one-shot import", () => {
  beforeEach(() => {
    setKeychainDriver(createInMemoryKeychainDriver());
  });

  afterEach(() => {
    resetKeychainDriverForTests();
  });

  it("imports the env value into Keychain when Keychain is empty", async () => {
    const env = loadEnv({ ...BASE_ENV, CURSOR_API_KEY: "sk-bootstrap-XYZ" });
    const dbClient = openTestDb();
    const repos = createRepositories(dbClient.raw);
    const apiKeyStore = new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE });
    const csrfSecretStore = new CsrfSecretStore({ service: env.KEYCHAIN_SERVICE });
    const { app } = await buildApp({
      env,
      repos,
      apiKeyStore,
      csrfSecretStore,
    });
    try {
      await app.ready();
      expect(await apiKeyStore.hasApiKey()).toBe(true);
      expect(await apiKeyStore.getApiKey()).toBe("sk-bootstrap-XYZ");
    } finally {
      await app.close();
      dbClient.raw.close();
    }
  });

  it("does NOT overwrite an existing Keychain entry", async () => {
    const env = loadEnv({ ...BASE_ENV, CURSOR_API_KEY: "sk-from-env" });
    const dbClient = openTestDb();
    const repos = createRepositories(dbClient.raw);
    const apiKeyStore = new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE });
    const csrfSecretStore = new CsrfSecretStore({ service: env.KEYCHAIN_SERVICE });

    // Seed Keychain with a pre-existing key.
    await apiKeyStore.setApiKey("sk-already-stored");

    const { app } = await buildApp({
      env,
      repos,
      apiKeyStore,
      csrfSecretStore,
    });
    try {
      await app.ready();
      expect(await apiKeyStore.getApiKey()).toBe("sk-already-stored");
    } finally {
      await app.close();
      dbClient.raw.close();
    }
  });

  it("is a no-op when CURSOR_API_KEY is unset", async () => {
    const env = loadEnv(BASE_ENV);
    const dbClient = openTestDb();
    const repos = createRepositories(dbClient.raw);
    const apiKeyStore = new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE });
    const csrfSecretStore = new CsrfSecretStore({ service: env.KEYCHAIN_SERVICE });
    const { app } = await buildApp({
      env,
      repos,
      apiKeyStore,
      csrfSecretStore,
    });
    try {
      await app.ready();
      expect(await apiKeyStore.hasApiKey()).toBe(false);
    } finally {
      await app.close();
      dbClient.raw.close();
    }
  });
});
