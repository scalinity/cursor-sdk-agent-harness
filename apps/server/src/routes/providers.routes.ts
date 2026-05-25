import { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import { addProviderRequestSchema } from "@harness/shared";
import type { ModelProviderSummary, UnifiedModel } from "@harness/shared";
import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { isBlockedIp } from "../services/docs-crawler.service.js";
import type {
  ModelProvidersRepo,
  ModelProviderRow,
} from "../db/repositories/model-providers.repo.js";
import type { ProviderKeyStore } from "../keychain/index.js";
import type { ModelRouter } from "../providers/model-router.js";
import type { ProviderKind } from "@harness/shared";

/**
 * Phase 23 — BYOK provider CRUD + unified model list. API keys never appear
 * on the wire; only `hasApiKey`. Keys live in the Keychain.
 */

export interface ProvidersRoutesDeps {
  modelProvidersRepo: ModelProvidersRepo;
  providerKeyStore: ProviderKeyStore;
  modelRouter: ModelRouter;
  logger: FastifyBaseLogger;
}

/**
 * P23-C3 (CWE-918): guard a user-supplied provider base URL before the server
 * ever fetches it. Cloud providers must resolve to a public address (reject
 * loopback/link-local/metadata/private); Ollama is a local server so its base
 * URL must be loopback (which also blocks the 169.254.169.254 metadata vector).
 */
async function assertSafeBaseUrl(provider: string, raw: string): Promise<void> {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Blocked protocol: ${u.protocol}`);
  }
  const { address } = await dns.lookup(u.hostname);
  if (provider === "ollama") {
    const loopback = address === "::1" || address === "127.0.0.1" || address.startsWith("127.");
    if (!loopback) {
      throw new Error("Ollama base URL must be loopback (127.0.0.1 / localhost / ::1)");
    }
    return;
  }
  if (isBlockedIp(address)) {
    throw new Error(`Blocked base URL: ${u.hostname} resolves to a private/loopback address`);
  }
}

async function toSummary(
  row: ModelProviderRow,
  keyStore: ProviderKeyStore,
): Promise<ModelProviderSummary> {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as ProviderKind,
    baseUrl: row.baseUrl,
    models: row.models,
    enabled: row.enabled,
    hasApiKey: await keyStore.has(row.id),
    createdAt: row.createdAt,
  };
}

export async function registerProvidersRoutes(
  app: FastifyInstance,
  deps: ProvidersRoutesDeps,
): Promise<void> {
  app.get("/api/providers", async (_request, reply) => {
    const rows = deps.modelProvidersRepo.list();
    const items = await Promise.all(rows.map((r) => toSummary(r, deps.providerKeyStore)));
    return reply.send({ items });
  });

  app.post("/api/providers", async (request, reply) => {
    const parsed = addProviderRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    const { name, provider, apiKey, baseUrl } = parsed.data;
    if (baseUrl) {
      try {
        await assertSafeBaseUrl(provider, baseUrl);
      } catch (err) {
        return reply.code(400).send({
          code: "UNSAFE_BASE_URL",
          message: err instanceof Error ? err.message : "Unsafe base URL",
        });
      }
    }
    const id = randomUUID();
    if (apiKey) await deps.providerKeyStore.set(id, apiKey);

    const row = deps.modelProvidersRepo.create({
      id,
      name,
      provider,
      apiKeyKeychainAccount: apiKey ? `provider:${id}:api-key` : null,
      baseUrl: baseUrl ?? null,
      models: [],
    });

    // Populate the model list from the provider (also validates the key).
    let models: string[] = [];
    try {
      const built = deps.modelRouter.instantiate(row, apiKey);
      if (built) models = (await built.listModels()).map((m) => m.id);
    } catch (err) {
      deps.logger.warn({ err, providerId: id }, "provider model list failed on add");
    }
    if (models.length > 0) deps.modelProvidersRepo.updateModels(id, models);

    const fresh = deps.modelProvidersRepo.getById(id)!;
    return reply.code(201).send(await toSummary(fresh, deps.providerKeyStore));
  });

  app.delete("/api/providers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = deps.modelProvidersRepo.getById(id);
    if (!row) return reply.code(404).send({ code: "NOT_FOUND", message: "Provider not found" });
    deps.modelProvidersRepo.delete(id);
    await deps.providerKeyStore.delete(id);
    return reply.code(204).send();
  });

  app.post("/api/providers/:id/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = deps.modelProvidersRepo.getById(id);
    if (!row) return reply.code(404).send({ code: "NOT_FOUND", message: "Provider not found" });
    const provider = await deps.modelRouter.buildProvider(id);
    if (!provider) {
      return reply.send({ ok: false, models: [], error: "Provider disabled or unbuildable" });
    }
    try {
      // P23-W3: validate mode lets a bad key / unreachable host fail the test
      // instead of silently degrading to a static fallback list.
      const models = (await provider.listModels({ validate: true })).map((m) => m.id);
      if (models.length > 0) deps.modelProvidersRepo.updateModels(id, models);
      return reply.send({ ok: true, models, error: null });
    } catch (err) {
      return reply.send({
        ok: false,
        models: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get("/api/models", async (_request, reply) => {
    const items: UnifiedModel[] = deps.modelRouter.listUnifiedModels();
    return reply.send({ items, autoAvailable: true });
  });
}
