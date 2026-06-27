import type { FastifyBaseLogger } from "fastify";
import { toHarnessModelId, type ProviderKind, type UnifiedModel } from "@harness/shared";
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
  /** Negative-cache lifetime after a no-key/error result. Default 30 seconds. */
  negativeTtlMs?: number;
  /** Clock injection point for tests. Default `Date.now`. */
  now?: () => number;
}

const DEFAULT_TTL_MS = 5 * 60_000;
/**
 * Short negative-cache window: after a no-key/error result, don't re-invoke
 * getApiKey()/listModels() on every /api/models hit. Far shorter than the
 * positive TTL so a freshly-added key / restored network is picked up quickly.
 */
const DEFAULT_NEGATIVE_TTL_MS = 30_000;

export class CursorModelCatalog {
  private cache: { at: number; models: UnifiedModel[] } | null = null;
  private inflight: Promise<UnifiedModel[]> | null = null;
  /** Epoch ms before which we serve the fallback without re-attempting discovery. */
  private negativeUntil = 0;

  constructor(private readonly deps: CursorModelCatalogDeps) {}

  /**
   * The discovered Cursor models, or `[]` when discovery is unavailable.
   * Concurrent calls share one in-flight request; a fresh cache is served
   * synchronously, and a recent failure is negative-cached so an outage or
   * missing key doesn't hammer the keychain/SDK on every call.
   */
  async list(): Promise<UnifiedModel[]> {
    const now = this.deps.now ?? Date.now;
    const ttl = this.deps.ttlMs ?? DEFAULT_TTL_MS;
    if (this.cache && now() - this.cache.at < ttl) return this.cache.models;
    if (now() < this.negativeUntil) return this.cache?.models ?? [];
    if (this.inflight) return this.inflight;
    this.inflight = this.refresh(now);
    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  private async refresh(now: () => number): Promise<UnifiedModel[]> {
    const negativeTtl = this.deps.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS;
    const apiKey = await this.deps.apiKeyStore.getApiKey();
    if (!apiKey) {
      this.negativeUntil = now() + negativeTtl;
      return this.cache?.models ?? [];
    }
    try {
      const sdkModels = await this.deps.sdk.listModels(apiKey);
      const models = sdkModels.map(toUnifiedCursorModel);
      this.cache = { at: now(), models };
      this.negativeUntil = 0;
      return models;
    } catch (err) {
      this.deps.logger.warn(
        { err },
        "cursor model discovery failed; falling back to cached/static catalog",
      );
      this.negativeUntil = now() + negativeTtl;
      return this.cache?.models ?? [];
    }
  }
}

/**
 * Map a discovered `SDKModel` (`ModelListItem`) to the unified model shape.
 * The SDK returns dotted ids (`composer-2.5`); we reconcile them back to the
 * harness id namespace (`composer-2-5-fast`) so the catalog, stored
 * `agent.modelId`, the picker selection, and `DEFAULT_MODEL_ID` all share one
 * id space. Models with no harness alias (e.g. proxied frontier models) keep
 * their SDK id, which `toSdkModelId` passes through unchanged at the boundary.
 */
function toUnifiedCursorModel(model: SDKModel): UnifiedModel {
  const id = toHarnessModelId(model.id);
  return {
    id,
    name: model.displayName,
    provider: "cursor" as ProviderKind,
    providerId: "cursor",
    capabilities: inferCapabilities("cursor", id),
    ...(model.parameters !== undefined ? { parameters: model.parameters } : {}),
    ...(model.variants !== undefined ? { variants: model.variants } : {}),
  };
}
