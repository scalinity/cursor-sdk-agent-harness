import { z } from "zod";

export const modelIdSchema = z.enum(["composer-2-5-fast", "composer-2-5"]);
export type ModelId = z.infer<typeof modelIdSchema>;

export const MODEL_LABELS: Record<ModelId, string> = {
  "composer-2-5-fast": "Composer 2.5 Fast",
  "composer-2-5": "Composer 2.5",
};

export const DEFAULT_MODEL_ID: ModelId = "composer-2-5-fast";

/**
 * Phase 23 — sentinel for Auto mode (system picks the model per task).
 * Stored as a run/agent model id; resolved to a concrete model at run start.
 */
export const AUTO_MODEL_ID = "auto" as const;

/**
 * A selected model id in the multi-provider world: a bare Cursor enum id, the
 * `auto` sentinel, or a provider-qualified `{providerId}:{modelName}` string.
 * Kept loose (a string) because BYOK model names are open-ended; the strict
 * `modelIdSchema` still guards the Cursor SDK boundary + pricing.
 */
export const unifiedModelIdSchema = z.string().min(1).max(200);
export type UnifiedModelId = z.infer<typeof unifiedModelIdSchema>;

/**
 * P23-W9: single source of truth for rendering a unified model id as a label.
 * `auto` → "Auto"; a known Cursor enum → its friendly label; a provider id
 * `{providerId}:{model}` → the model part. Used by the composer, statusbar,
 * and default-agent naming so they never diverge.
 */
export function formatModelLabel(modelId: string): string {
  if (modelId === AUTO_MODEL_ID) return "Auto";
  const known = (MODEL_LABELS as Record<string, string>)[modelId];
  if (known) return known;
  const colon = modelId.indexOf(":");
  return colon > 0 ? modelId.slice(colon + 1) : modelId;
}

/**
 * Per-model parameters — e.g. "thinking"/reasoning effort, max mode. Mirrors
 * the Cursor SDK's `ModelSelection` / `ModelListItem` shapes verbatim. The
 * allowed values are DISCOVERED at runtime via `Cursor.models.list()` and are
 * model-specific; never hardcode the set here.
 *
 * - `ModelParameterValue` (`{ id, value }`) is a chosen setting, e.g.
 *   `{ id: "thinking", value: "high" }`, sent with a model selection.
 * - `ModelParameterDefinition` describes one parameter and its allowed values.
 * - `ModelVariant` is a named preset bundle of params.
 */
export const modelParameterValueSchema = z.object({
  id: z.string().min(1),
  value: z.string(),
});
export type ModelParameterValue = z.infer<typeof modelParameterValueSchema>;

export const modelParameterDefinitionSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().optional(),
  values: z.array(
    z.object({ value: z.string(), displayName: z.string().optional() }),
  ),
});
export type ModelParameterDefinition = z.infer<typeof modelParameterDefinitionSchema>;

export const modelVariantSchema = z.object({
  params: z.array(modelParameterValueSchema),
  displayName: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
});
export type ModelVariant = z.infer<typeof modelVariantSchema>;

/**
 * Harness model id ↔ Cursor SDK model id. The harness keeps two legacy composer
 * ids (`composer-2-5-fast` / `composer-2-5`) for pricing keys + UI labels and as
 * the default-agent id, while `Cursor.models.list()` exposes ONE real model,
 * dotted `composer-2.5`, with a `fast` parameter (verified against a live key:
 * the "fast" split is a parameter, not a separate model). Both legacy ids
 * therefore map to `composer-2.5` — NOT to the distinct older `composer-2`
 * model, which keeps its own real id and is surfaced separately by discovery.
 *
 * The inverse is hand-written (not derived) because the forward map is
 * many-to-one: `composer-2.5` must reconcile to the DEFAULT id
 * `composer-2-5-fast` so the default agent matches its discovered catalog entry
 * (and thus gets the effort control — F-004).
 *
 * Upgrade triggers: a new SDK model literal the harness wants to alias, or a
 * renamed literal — update both maps.
 */
export const HARNESS_TO_SDK_MODEL_ID: Readonly<Record<string, string>> = {
  "composer-2-5-fast": "composer-2.5",
  "composer-2-5": "composer-2.5",
};

const SDK_TO_HARNESS_MODEL_ID: Readonly<Record<string, string>> = {
  "composer-2.5": "composer-2-5-fast",
};

/** Map a harness/unified model id to the id `@cursor/sdk` expects. Unknown ids pass through. */
export function toSdkModelId(modelId: string): string {
  return HARNESS_TO_SDK_MODEL_ID[modelId] ?? modelId;
}

/** Map a discovered SDK model id back to its harness id, when one exists. Else passthrough. */
export function toHarnessModelId(sdkModelId: string): string {
  return SDK_TO_HARNESS_MODEL_ID[sdkModelId] ?? sdkModelId;
}

/** Minimal shape for effort-parameter discovery — anything carrying `parameters`/`variants`. */
interface ModelParamCarrier {
  parameters?: ModelParameterDefinition[] | undefined;
}

/**
 * Matches a parameter id/displayName that represents reasoning/thinking effort.
 * Single source of truth shared by the web composer and the CLI `/effort`
 * command so they never disagree about which discovered parameter is "effort".
 */
export const EFFORT_PARAM_RE = /thinking|reasoning|effort/i;

/**
 * The model's thinking/effort parameter, discovered from the catalog. Matched
 * by id or displayName only — no "sole parameter" fallback, so an unrelated
 * single parameter (e.g. `verbosity`) is never mislabelled as effort. Returns
 * null when the model exposes no effort-like parameter.
 */
export function findEffortParameter(model: ModelParamCarrier): ModelParameterDefinition | null {
  const params = model.parameters ?? [];
  return (
    params.find(
      (p) => EFFORT_PARAM_RE.test(p.id) || (p.displayName ? EFFORT_PARAM_RE.test(p.displayName) : false),
    ) ?? null
  );
}

export const settingSourceSchema = z.enum([
  "project",
  "user",
  "team",
  "mdm",
  "plugins",
  "all",
]);
export type SettingSource = z.infer<typeof settingSourceSchema>;

export const sdkRunStatusSchema = z.enum([
  "CREATING",
  "RUNNING",
  "FINISHED",
  "ERROR",
  "CANCELLED",
  "EXPIRED",
]);
export type SdkRunStatus = z.infer<typeof sdkRunStatusSchema>;

export const SDK_RUN_TERMINAL_STATUSES: ReadonlySet<SdkRunStatus> = new Set([
  "FINISHED",
  "ERROR",
  "CANCELLED",
  "EXPIRED",
]);

export const agentStatusSchema = z.enum([
  "creating",
  "active",
  "terminated",
  "error",
]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const agentModeSchema = z.enum(["local", "cloud"]);
export type AgentMode = z.infer<typeof agentModeSchema>;

export const executionModeSchema = z.enum(["ask", "agent", "yolo"]);
export type ExecutionMode = z.infer<typeof executionModeSchema>;

export const usageSourceSchema = z.enum([
  "sdk_final_result",
  "derived",
  "unavailable",
]);
export type UsageSource = z.infer<typeof usageSourceSchema>;

export const mcpValidationStatusSchema = z.enum([
  "unknown",
  "valid",
  "invalid",
  "unreachable",
]);
export type McpValidationStatus = z.infer<typeof mcpValidationStatusSchema>;

export const replaySpeedSchema = z.enum(["instant", "1x", "2x", "4x"]);
export type ReplaySpeed = z.infer<typeof replaySpeedSchema>;

export const themeSettingSchema = z.enum(["dark", "light", "system"]);
export type ThemeSetting = z.infer<typeof themeSettingSchema>;

export const knownLanguageSchema = z.enum([
  "typescript",
  "javascript",
  "python",
  "json",
  "markdown",
  "shell",
  "plain-text",
]);
export type KnownLanguage = z.infer<typeof knownLanguageSchema>;
