import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CsrfSecretStore,
  CursorApiKeyStore,
  LocalSessionSecretStore,
} from "../index.js";
import {
  createInMemoryKeychainDriver,
  resetKeychainDriverForTests,
  setKeychainDriver,
} from "../testing.js";

const SERVICE = "cursor-sdk-agent-harness-test";

describe("keychain", () => {
  beforeEach(() => {
    setKeychainDriver(createInMemoryKeychainDriver());
  });

  afterEach(() => {
    resetKeychainDriverForTests();
  });

  describe("CursorApiKeyStore", () => {
    it("starts absent, can set, retrieve, presence-check, and delete", async () => {
      const store = new CursorApiKeyStore({ service: SERVICE });

      expect(await store.hasApiKey()).toBe(false);
      expect(await store.getApiKey()).toBeNull();

      await store.setApiKey("sk-test-abc123");
      expect(await store.hasApiKey()).toBe(true);
      expect(await store.getApiKey()).toBe("sk-test-abc123");

      await store.deleteApiKey();
      expect(await store.hasApiKey()).toBe(false);
      expect(await store.getApiKey()).toBeNull();
    });

    it("refuses to store a value shorter than 8 chars", async () => {
      const store = new CursorApiKeyStore({ service: SERVICE });
      await expect(store.setApiKey("")).rejects.toThrow(/at least 8 characters/);
      await expect(store.setApiKey("short")).rejects.toThrow(/at least 8 characters/);
    });

    it("refuses to store a value longer than 512 chars", async () => {
      const store = new CursorApiKeyStore({ service: SERVICE });
      await expect(store.setApiKey("a".repeat(513))).rejects.toThrow(/at most 512/);
    });

    it("isolates by service name", async () => {
      const a = new CursorApiKeyStore({ service: "svc-a" });
      const b = new CursorApiKeyStore({ service: "svc-b" });
      await a.setApiKey("sk-svc-a-XX");
      expect(await a.getApiKey()).toBe("sk-svc-a-XX");
      expect(await b.getApiKey()).toBeNull();
    });
  });

  describe("LocalSessionSecretStore", () => {
    it("returns the same secret across calls", async () => {
      const store = new LocalSessionSecretStore({ service: SERVICE });
      const first = await store.getOrCreate();
      const second = await store.getOrCreate();
      expect(first).toBe(second);
      expect(first.length).toBeGreaterThan(32);
    });

    it("regenerates after reset", async () => {
      const store = new LocalSessionSecretStore({ service: SERVICE });
      const first = await store.getOrCreate();
      await store.reset();
      const second = await store.getOrCreate();
      expect(second).not.toBe(first);
    });
  });

  describe("CsrfSecretStore", () => {
    it("is independent from the session secret", async () => {
      const session = new LocalSessionSecretStore({ service: SERVICE });
      const csrf = new CsrfSecretStore({ service: SERVICE });
      const s = await session.getOrCreate();
      const c = await csrf.getOrCreate();
      expect(s).not.toBe(c);
    });
  });
});
