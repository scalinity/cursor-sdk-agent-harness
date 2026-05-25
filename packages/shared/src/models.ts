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
