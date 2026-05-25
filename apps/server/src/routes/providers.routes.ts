import { randomUUID } from "node:crypto";
import { addProviderRequestSchema } from "@harness/shared";
import type { ModelProviderSummary, UnifiedModel } from "@harness/shared";
import type { FastifyInstance, FastifyBaseLogger } from "fastify";
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
      const models = (await provider.listModels()).map((m) => m.id);
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
