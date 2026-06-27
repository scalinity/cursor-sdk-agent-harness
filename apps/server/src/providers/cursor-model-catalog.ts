import type { FastifyBaseLogger } from "fastify";
import type { ProviderKind, UnifiedModel } from "@harness/shared";
import type { CursorApiKeyStore } from "../keychain/index.js";
import type { SdkAdapter, SDKModel } from "../sdk/sdk-adapter.js";
import { inferCapabilities } from "./model-registry.js";

/**
 * Live Cursor model discovery via `Cursor.models.list()`. Returns the
 * account's available Cursor models with each model's discovered parameters
 * (thinking/reasoning effort, max mode) and preset variants — the values that
 * drive the `/effort` control and the model picker.
 *
 * The result is cached for `ttlMs` so the picker doesn't make a network call
 * on every render. Discovery is best-effort: with no API key, no network, or
 * an SDK error, `list()` returns the last good cache or `[]`, and callers fall
 * back to the static `CURSOR_MODELS` registry. Per the "honest about the SDK"
 * rule, the allowed parameter values are never hardcoded — they come straight
 * from the SDK.
 */
export interface CursorModelCatalogDeps {
  sdk: Pick<SdkAdapter, "listModels">;
  apiKeyStore: Pick<CursorApiKeyStore, "getApiKey">;
  logger: FastifyBaseLogger;
  /** Cache lifetime. Default 5 minutes. */
  ttlMs?: number;
  /** Clock injection point for tests. Default `Date.now`. */
  now?: () => number;
}

const DEFAULT_TTL_MS = 5 * 60_000;

export class CursorModelCatalog {
  private cache: { at: number; models: UnifiedModel[] } | null = null;
  private inflight: Promise<UnifiedModel[]> | null = null;

  constructor(private readonly deps: CursorModelCatalogDeps) {}

  /**
   * The discovered Cursor models, or `[]` when discovery is unavailable.
   * Concurrent calls share one in-flight request; a fresh cache is served
   * synchronously.
   */
  async list(): Promise<UnifiedModel[]> {
    const now = this.deps.now ?? Date.now;
    const ttl = this.deps.ttlMs ?? DEFAULT_TTL_MS;
    if (this.cache && now() - this.cache.at < ttl) return this.cache.models;
    if (this.inflight) return this.inflight;
    this.inflight = this.refresh(now);
    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  private async refresh(now: () => number): Promise<UnifiedModel[]> {
    const apiKey = await this.deps.apiKeyStore.getApiKey();
    if (!apiKey) return this.cache?.models ?? [];
    try {
      const sdkModels = await this.deps.sdk.listModels(apiKey);
      const models = sdkModels.map(toUnifiedCursorModel);
      this.cache = { at: now(), models };
      return models;
    } catch (err) {
      this.deps.logger.warn(
        { err },
        "cursor model discovery failed; falling back to cached/static catalog",
      );
      return this.cache?.models ?? [];
    }
  }
}

/** Map a discovered `SDKModel` (`ModelListItem`) to the unified model shape. */
function toUnifiedCursorModel(model: SDKModel): UnifiedModel {
  return {
    id: model.id,
    name: model.displayName,
    provider: "cursor" as ProviderKind,
    providerId: "cursor",
    capabilities: inferCapabilities("cursor", model.id),
    ...(model.parameters !== undefined ? { parameters: model.parameters } : {}),
    ...(model.variants !== undefined ? { variants: model.variants } : {}),
  };
}
