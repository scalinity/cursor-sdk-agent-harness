import { AUTO_MODEL_ID, DEFAULT_MODEL_ID, type ProviderKind, type UnifiedModel } from "@harness/shared";
import type {
  ModelProvidersRepo,
  ModelProviderRow,
} from "../db/repositories/model-providers.repo.js";
import type { ProviderKeyStore } from "../keychain/index.js";
import type { ModelProvider } from "./provider.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import { GoogleProvider } from "./google-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import {
  CURSOR_MODELS,
  inferCapabilities,
  inferPricing,
  selectAutoModel,
  type TaskCharacteristics,
} from "./model-registry.js";

/**
 * Phase 23 — routes a selected model id to either the Cursor SDK path or a
 * direct provider client, and builds the unified model list. A bare id is a
 * Cursor model; `auto` is the heuristic sentinel; `{providerId}:{modelName}`
 * is a BYOK provider model (split on the first colon — Ollama names like
 * `llama3:8b` keep their own colon).
 */

export type ParsedModelId =
  | { kind: "auto" }
  | { kind: "cursor"; modelName: string }
  | { kind: "provider"; providerId: string; modelName: string };

export function parseModelId(id: string): ParsedModelId {
  if (id === AUTO_MODEL_ID) return { kind: "auto" };
  const idx = id.indexOf(":");
  if (idx > 0) {
    return { kind: "provider", providerId: id.slice(0, idx), modelName: id.slice(idx + 1) };
  }
  return { kind: "cursor", modelName: id };
}

export interface ResolvedRunModel {
  /** Unified id stored on the run row. */
  unifiedId: string;
  /** Underlying model name passed to the SDK / provider API. */
  modelName: string;
  /** null = Cursor SDK path; otherwise drive this provider directly. */
  provider: ModelProvider | null;
  isCursor: boolean;
}

export interface ModelRouterDeps {
  modelProvidersRepo: ModelProvidersRepo;
  providerKeyStore: ProviderKeyStore;
  /**
   * Optional live Cursor model discovery. When present, `listAllModels()`
   * prefers the discovered catalog (with per-model parameters/variants) over
   * the static `CURSOR_MODELS` registry; falls back to static when discovery
   * yields nothing.
   */
  cursorCatalog?: { list(): Promise<UnifiedModel[]> };
}

export class ModelRouter {
  constructor(private readonly deps: ModelRouterDeps) {}

  isCursorModel(id: string): boolean {
    return parseModelId(id).kind === "cursor";
  }

  instantiate(row: ModelProviderRow, apiKey: string | undefined): ModelProvider | null {
    const config = {
      id: row.id,
      name: row.name,
      apiKey,
      baseUrl: row.baseUrl ?? undefined,
    };
    switch (row.provider) {
      case "anthropic":
        return new AnthropicProvider(config);
      case "openai":
        return new OpenAIProvider(config);
      case "google":
        return new GoogleProvider(config);
      case "ollama":
        return new OllamaProvider(config);
      default:
        return null;
    }
  }

  async buildProvider(providerId: string): Promise<ModelProvider | null> {
    const row = this.deps.modelProvidersRepo.getById(providerId);
    if (!row || !row.enabled) return null;
    const apiKey = (await this.deps.providerKeyStore.get(providerId)) ?? undefined;
    return this.instantiate(row, apiKey);
  }

  /**
   * All selectable models from the STATIC registry: Cursor built-ins + each
   * enabled provider's models. Synchronous — used by `resolve()`'s Auto
   * heuristic. For the user-facing catalog (with discovered Cursor params),
   * use `listAllModels()`.
   */
  listUnifiedModels(): UnifiedModel[] {
    return [...this.staticCursorModels(), ...this.listProviderModels()];
  }

  /**
   * The user-facing catalog: live-discovered Cursor models (with per-model
   * parameters/variants) when available, else the static registry, plus each
   * enabled provider's models.
   */
  async listAllModels(): Promise<UnifiedModel[]> {
    const discovered = this.deps.cursorCatalog
      ? await this.deps.cursorCatalog.list()
      : [];
    return [
      ...mergeCursorModels(this.staticCursorModels(), discovered),
      ...this.listProviderModels(),
    ];
  }

  private staticCursorModels(): UnifiedModel[] {
    return CURSOR_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      provider: "cursor" as ProviderKind,
      providerId: "cursor",
      capabilities: inferCapabilities("cursor", m.id),
    }));
  }

  private listProviderModels(): UnifiedModel[] {
    const out: UnifiedModel[] = [];
    for (const row of this.deps.modelProvidersRepo.list()) {
      if (!row.enabled) continue;
      const kind = row.provider as ProviderKind;
      for (const modelName of row.models) {
        const pricing = inferPricing(modelName);
        out.push({
          id: `${row.id}:${modelName}`,
          name: modelName,
          provider: kind,
          providerId: row.id,
          capabilities: inferCapabilities(kind, modelName),
          ...(pricing ? { pricing } : {}),
        });
      }
    }
    return out;
  }

  /**
   * Resolve a selected id (including `auto`) to a concrete run model. Falls
   * back to the default Cursor model when a provider is missing/disabled or
   * Auto finds nothing.
   */
  async resolve(selectedId: string, task: TaskCharacteristics): Promise<ResolvedRunModel> {
    let id = selectedId;
    if (parseModelId(id).kind === "auto") {
      id = selectAutoModel(task, this.listUnifiedModels()) ?? DEFAULT_MODEL_ID;
    }
    const parsed = parseModelId(id);
    if (parsed.kind === "provider") {
      const provider = await this.buildProvider(parsed.providerId);
      if (provider) {
        return { unifiedId: id, modelName: parsed.modelName, provider, isCursor: false };
      }
      return cursorFallback();
    }
    if (parsed.kind === "cursor") {
      return { unifiedId: id, modelName: parsed.modelName, provider: null, isCursor: true };
    }
    return cursorFallback();
  }
}

/**
 * Overlay discovered Cursor models onto the static registry, keyed by id (both
 * are in the harness id namespace after the catalog reconciles SDK ids). A
 * discovered entry replaces its static counterpart in place (carrying the
 * model's parameters/variants); discovered-only models append after the static
 * set. Merging — rather than replacing — keeps a static fallback row visible
 * when a transient/partial discovery omits it.
 */
function mergeCursorModels(
  staticModels: UnifiedModel[],
  discovered: UnifiedModel[],
): UnifiedModel[] {
  if (discovered.length === 0) return staticModels;
  const byId = new Map<string, UnifiedModel>(staticModels.map((m) => [m.id, m]));
  for (const model of discovered) byId.set(model.id, model);
  return [...byId.values()];
}

function cursorFallback(): ResolvedRunModel {
  return { unifiedId: DEFAULT_MODEL_ID, modelName: DEFAULT_MODEL_ID, provider: null, isCursor: true };
}
