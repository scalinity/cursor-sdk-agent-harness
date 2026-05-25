import type {
  ExecutionMode,
  ModelCapabilities,
  ModelPricingHint,
  ProviderKind,
  UnifiedModel,
} from "@harness/shared";

/**
 * Phase 23 — static knowledge about models: capability + pricing hints,
 * fallback model lists per provider, and a coarse speed/capability tier used
 * by Auto mode. None of this is authoritative (the provider's real model list
 * comes from its API); it's display metadata + heuristics.
 */

export type ModelTier = "fast" | "balanced" | "capable";

export interface FallbackModel {
  name: string;
  label: string;
}

/** Known models used as a fallback when a provider's list API is unavailable. */
export const FALLBACK_MODELS: Record<Exclude<ProviderKind, "cursor" | "ollama">, FallbackModel[]> =
  {
    anthropic: [
      { name: "claude-opus-4-1", label: "Claude Opus 4.1" },
      { name: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
      { name: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
    openai: [
      { name: "gpt-5", label: "GPT-5" },
      { name: "gpt-5-mini", label: "GPT-5 mini" },
      { name: "gpt-4.1", label: "GPT-4.1" },
    ],
    google: [
      { name: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { name: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ],
  };

/** Built-in Cursor models (the only tool-capable models in v1.2). */
export const CURSOR_MODELS: ReadonlyArray<{ id: string; name: string; tier: ModelTier }> = [
  { id: "composer-2-5-fast", name: "Composer 2.5 Fast", tier: "fast" },
  { id: "composer-2-5", name: "Composer 2.5", tier: "capable" },
];

const FAST_HINTS = /(haiku|mini|flash|fast|nano|lite)/i;
const CAPABLE_HINTS = /(opus|gpt-5|o[1-9]|pro|ultra|sonnet-4|composer-2-5$)/i;
const VISION_HINTS = /(gpt-5|gpt-4|gemini|claude|opus|sonnet|haiku|o[1-9])/i;
const THINKING_HINTS = /(opus|sonnet|gpt-5|o[1-9]|gemini-2\.5|thinking|reasoning)/i;

export function inferTier(modelId: string): ModelTier {
  if (FAST_HINTS.test(modelId)) return "fast";
  if (CAPABLE_HINTS.test(modelId)) return "capable";
  return "balanced";
}

/** Capabilities for a model. Only Cursor models get tool-use in v1.2. */
export function inferCapabilities(kind: ProviderKind, modelName: string): ModelCapabilities {
  if (kind === "cursor") {
    return { toolUse: true, thinking: true, vision: true, streaming: true };
  }
  return {
    toolUse: false,
    thinking: THINKING_HINTS.test(modelName),
    vision: VISION_HINTS.test(modelName),
    streaming: true,
  };
}

/** Rough per-million-token pricing hints (micro-USD) for well-known models. */
export function inferPricing(modelName: string): ModelPricingHint | undefined {
  const table: Array<[RegExp, ModelPricingHint]> = [
    [/opus/i, { inputPerMillionMicros: 15_000_000, outputPerMillionMicros: 75_000_000 }],
    [/sonnet/i, { inputPerMillionMicros: 3_000_000, outputPerMillionMicros: 15_000_000 }],
    [/haiku/i, { inputPerMillionMicros: 1_000_000, outputPerMillionMicros: 5_000_000 }],
    [/gpt-5-mini/i, { inputPerMillionMicros: 250_000, outputPerMillionMicros: 2_000_000 }],
    [/gpt-5/i, { inputPerMillionMicros: 1_250_000, outputPerMillionMicros: 10_000_000 }],
    [/gemini-2\.5-flash/i, { inputPerMillionMicros: 300_000, outputPerMillionMicros: 2_500_000 }],
    [/gemini-2\.5-pro/i, { inputPerMillionMicros: 1_250_000, outputPerMillionMicros: 10_000_000 }],
  ];
  for (const [re, price] of table) if (re.test(modelName)) return price;
  return undefined;
}

export interface TaskCharacteristics {
  promptTokens: number;
  mode: ExecutionMode;
}

const TIER_RANK: Record<ModelTier, number> = { fast: 0, balanced: 1, capable: 2 };

/**
 * Auto-mode model selection. Agent/YOLO modes require tool-use, so they can
 * only pick a tool-capable (Cursor) model. Otherwise: short Ask prompts →
 * fastest; long prompts → most capable; everything else → balanced.
 */
export function selectAutoModel(
  task: TaskCharacteristics,
  models: UnifiedModel[],
): string | null {
  if (models.length === 0) return null;

  if (task.mode === "agent" || task.mode === "yolo") {
    const toolCapable = models.filter((m) => m.capabilities.toolUse);
    return pickByTier(toolCapable.length > 0 ? toolCapable : models, "capable");
  }
  if (task.promptTokens < 500 && task.mode === "ask") {
    return pickByTier(models, "fast");
  }
  if (task.promptTokens > 2000) {
    return pickByTier(models, "capable");
  }
  return pickByTier(models, "balanced");
}

function pickByTier(models: UnifiedModel[], target: ModelTier): string {
  let best = models[0]!;
  let bestDist = Infinity;
  for (const m of models) {
    const tier = inferTier(m.id) === "balanced" ? inferTier(m.name) : inferTier(m.id);
    const dist = Math.abs(TIER_RANK[tier] - TIER_RANK[target]);
    if (dist < bestDist) {
      bestDist = dist;
      best = m;
    }
  }
  return best.id;
}
