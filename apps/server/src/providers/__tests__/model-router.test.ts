import { describe, it, expect, afterEach } from "vitest";
import type { UnifiedModel } from "@harness/shared";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { ProviderKeyStore } from "../../keychain/index.js";
import { ModelRouter, parseModelId } from "../model-router.js";
import { selectAutoModel } from "../model-registry.js";

function unified(id: string, toolUse: boolean): UnifiedModel {
  return {
    id,
    name: id,
    provider: toolUse ? "cursor" : "openai",
    providerId: toolUse ? "cursor" : "p1",
    capabilities: { toolUse, thinking: false, vision: false, streaming: true },
  };
}

describe("parseModelId", () => {
  it("classifies cursor, auto, and provider ids", () => {
    expect(parseModelId("composer-2-5-fast")).toEqual({ kind: "cursor", modelName: "composer-2-5-fast" });
    expect(parseModelId("auto")).toEqual({ kind: "auto" });
    expect(parseModelId("p1:gpt-5")).toEqual({ kind: "provider", providerId: "p1", modelName: "gpt-5" });
  });

  it("splits provider id on the first colon (Ollama names keep theirs)", () => {
    expect(parseModelId("p1:llama3:8b")).toEqual({
      kind: "provider",
      providerId: "p1",
      modelName: "llama3:8b",
    });
  });
});

describe("selectAutoModel", () => {
  const models: UnifiedModel[] = [
    unified("composer-2-5-fast", true),
    unified("composer-2-5", true),
    unified("p1:gpt-5", false),
    unified("p1:gpt-5-mini", false),
  ];

  it("picks a fast model for short Ask prompts", () => {
    const id = selectAutoModel({ promptTokens: 100, mode: "ask" }, models);
    expect(["composer-2-5-fast", "p1:gpt-5-mini"]).toContain(id);
  });

  it("picks a tool-capable model for Agent mode", () => {
    const id = selectAutoModel({ promptTokens: 100, mode: "agent" }, models);
    expect(id).toBe("composer-2-5"); // most capable tool-capable
  });

  it("picks a capable model for long prompts", () => {
    const id = selectAutoModel({ promptTokens: 5000, mode: "ask" }, models);
    expect(["composer-2-5", "p1:gpt-5"]).toContain(id);
  });

  it("returns null with no models", () => {
    expect(selectAutoModel({ promptTokens: 10, mode: "ask" }, [])).toBeNull();
  });
});

describe("ModelRouter.listUnifiedModels", () => {
  let db: ReturnType<typeof openTestDb> | null = null;
  afterEach(() => {
    db?.close();
    db = null;
  });

  it("lists Cursor built-ins plus enabled provider models with correct capabilities", () => {
    db = openTestDb({ skipSeed: true });
    const repos = createRepositories(db.raw);
    const p = repos.modelProviders.create({
      name: "My OpenAI",
      provider: "openai",
      apiKeyKeychainAccount: "provider:x:api-key",
      baseUrl: null,
      models: ["gpt-5", "gpt-5-mini"],
    });
    const router = new ModelRouter({
      modelProvidersRepo: repos.modelProviders,
      providerKeyStore: new ProviderKeyStore({ service: "test" }),
    });
    const models = router.listUnifiedModels();
    const cursor = models.filter((m) => m.provider === "cursor");
    const openai = models.filter((m) => m.provider === "openai");
    expect(cursor.length).toBe(2);
    expect(cursor.every((m) => m.capabilities.toolUse)).toBe(true);
    expect(openai.length).toBe(2);
    expect(openai.every((m) => m.capabilities.toolUse === false)).toBe(true);
    expect(openai.map((m) => m.id)).toContain(`${p.id}:gpt-5`);
  });
});

describe("ModelRouter.resolve", () => {
  let db: ReturnType<typeof openTestDb> | null = null;
  afterEach(() => {
    db?.close();
    db = null;
  });

  function makeRouter(): ModelRouter {
    db = openTestDb({ skipSeed: true });
    const repos = createRepositories(db.raw);
    return new ModelRouter({
      modelProvidersRepo: repos.modelProviders,
      providerKeyStore: new ProviderKeyStore({ service: "test" }),
    });
  }

  it("resolves a bare Cursor id to the SDK path", async () => {
    const r = await makeRouter().resolve("composer-2-5", { promptTokens: 50, mode: "ask" });
    expect(r.isCursor).toBe(true);
    expect(r.provider).toBeNull();
    expect(r.modelName).toBe("composer-2-5");
  });

  it("resolves auto to a concrete Cursor model when no providers exist", async () => {
    const r = await makeRouter().resolve("auto", { promptTokens: 50, mode: "ask" });
    expect(r.isCursor).toBe(true);
    expect(r.unifiedId).toMatch(/^composer-2-5/);
  });

  it("falls back to the default Cursor model when the provider is missing", async () => {
    const r = await makeRouter().resolve("nonexistent-id:gpt-5", { promptTokens: 50, mode: "ask" });
    expect(r.isCursor).toBe(true);
    expect(r.provider).toBeNull();
    expect(r.unifiedId).toBe("composer-2-5-fast");
  });
});
