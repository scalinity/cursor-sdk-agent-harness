import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { ProviderKeyStore } from "../../keychain/index.js";
import {
  createInMemoryKeychainDriver,
  setKeychainDriver,
  resetKeychainDriverForTests,
} from "../../keychain/testing.js";
import { ModelRouter } from "../../providers/model-router.js";
import type { ModelProvider } from "../../providers/provider.js";
import { registerProvidersRoutes } from "../providers.routes.js";

// A fake provider so add / test-connection never hit the network.
class FakeProvider implements ModelProvider {
  readonly kind = "openai";
  constructor(
    readonly id: string,
    readonly name: string,
  ) {}
  // eslint-disable-next-line require-yield
  async *sendMessage(): AsyncIterable<never> {
    return;
  }
  listModels() {
    return Promise.resolve([{ id: "fake-model", name: "Fake Model" }]);
  }
}

// Router that builds the fake provider (no network), real repo for listing.
class TestRouter extends ModelRouter {
  override instantiate(): ModelProvider {
    return new FakeProvider("x", "Fake");
  }
  override buildProvider(): Promise<ModelProvider | null> {
    return Promise.resolve(new FakeProvider("x", "Fake"));
  }
}

describe("/api/providers", () => {
  let cleanup: Array<() => void | Promise<void>>;

  beforeEach(() => {
    setKeychainDriver(createInMemoryKeychainDriver());
    cleanup = [];
  });
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
    resetKeychainDriverForTests();
  });

  function setup() {
    const db = openTestDb({ skipSeed: true });
    const repos = createRepositories(db.raw);
    const app = Fastify({ logger: false });
    const providerKeyStore = new ProviderKeyStore({ service: "test" });
    const router = new TestRouter({ modelProvidersRepo: repos.modelProviders, providerKeyStore });
    cleanup.push(() => app.close(), () => db.close());
    return { db, repos, app, providerKeyStore, router };
  }

  async function register() {
    const ctx = setup();
    await registerProvidersRoutes(ctx.app, {
      modelProvidersRepo: ctx.repos.modelProviders,
      providerKeyStore: ctx.providerKeyStore,
      modelRouter: ctx.router,
      logger: ctx.app.log,
    });
    return ctx;
  }

  it("lists empty providers initially", async () => {
    const { app } = await register();
    const res = await app.inject({ method: "GET", url: "/api/providers" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });

  it("adds a provider, stores the key in the keychain, and lists it redacted", async () => {
    const { app } = await register();
    const res = await app.inject({
      method: "POST",
      url: "/api/providers",
      payload: { name: "My OpenAI", provider: "openai", apiKey: "sk-test-key-123456" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("My OpenAI");
    expect(body.hasApiKey).toBe(true);
    expect(body).not.toHaveProperty("apiKey");
    expect(body.models).toContain("fake-model"); // populated from listModels

    const list = await app.inject({ method: "GET", url: "/api/providers" });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0].hasApiKey).toBe(true);
  });

  it("tests a provider connection and returns its models", async () => {
    const { app, repos } = await register();
    const p = repos.modelProviders.create({
      name: "P",
      provider: "openai",
      apiKeyKeychainAccount: null,
      baseUrl: null,
      models: [],
    });
    const res = await app.inject({ method: "POST", url: `/api/providers/${p.id}/test` });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().models).toContain("fake-model");
  });

  it("deletes a provider and its key", async () => {
    const { app, repos, providerKeyStore } = await register();
    const p = repos.modelProviders.create({
      name: "P",
      provider: "openai",
      apiKeyKeychainAccount: `provider:p:api-key`,
      baseUrl: null,
      models: [],
    });
    await providerKeyStore.set(p.id, "sk-xyz-123456");
    const res = await app.inject({ method: "DELETE", url: `/api/providers/${p.id}` });
    expect(res.statusCode).toBe(204);
    expect(repos.modelProviders.getById(p.id)).toBeNull();
    expect(await providerKeyStore.has(p.id)).toBe(false);
  });

  it("returns the unified model list with Cursor built-ins + provider models", async () => {
    const { app, repos } = await register();
    repos.modelProviders.create({
      name: "P",
      provider: "anthropic",
      apiKeyKeychainAccount: null,
      baseUrl: null,
      models: ["claude-sonnet-4-5"],
    });
    const res = await app.inject({ method: "GET", url: "/api/models" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.autoAvailable).toBe(true);
    const cursor = body.items.filter((m: { provider: string }) => m.provider === "cursor");
    const anthropic = body.items.filter((m: { provider: string }) => m.provider === "anthropic");
    expect(cursor.length).toBe(2);
    expect(cursor.every((m: { capabilities: { toolUse: boolean } }) => m.capabilities.toolUse)).toBe(true);
    expect(anthropic.length).toBe(1);
    expect(anthropic[0].capabilities.toolUse).toBe(false);
  });

  it("422s on an invalid add payload", async () => {
    const { app } = await register();
    const res = await app.inject({
      method: "POST",
      url: "/api/providers",
      payload: { name: "", provider: "nope" },
    });
    expect(res.statusCode).toBe(422);
  });

  // P23-C3: SSRF guard on baseUrl (literal IPs avoid real DNS lookups).
  it("rejects a cloud provider baseUrl pointing at a metadata/private IP", async () => {
    const { app } = await register();
    const res = await app.inject({
      method: "POST",
      url: "/api/providers",
      payload: { name: "evil", provider: "openai", baseUrl: "http://169.254.169.254/" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("UNSAFE_BASE_URL");
  });

  it("rejects an Ollama baseUrl pointing at a non-loopback host", async () => {
    const { app } = await register();
    const res = await app.inject({
      method: "POST",
      url: "/api/providers",
      payload: { name: "remote-ollama", provider: "ollama", baseUrl: "http://1.2.3.4:11434/" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("UNSAFE_BASE_URL");
  });

  it("allows a loopback Ollama baseUrl and a public cloud baseUrl", async () => {
    const { app } = await register();
    const ollama = await app.inject({
      method: "POST",
      url: "/api/providers",
      payload: { name: "local", provider: "ollama", baseUrl: "http://127.0.0.1:11434/" },
    });
    expect(ollama.statusCode).toBe(201);
    const cloud = await app.inject({
      method: "POST",
      url: "/api/providers",
      payload: { name: "proxy", provider: "openai", baseUrl: "http://1.2.3.4/" },
    });
    expect(cloud.statusCode).toBe(201);
  });
});
