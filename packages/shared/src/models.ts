import { z } from "zod";

export const modelIdSchema = z.enum(["composer-2-5-fast", "composer-2-5"]);
export type ModelId = z.infer<typeof modelIdSchema>;

export const MODEL_LABELS: Record<ModelId, string> = {
  "composer-2-5-fast": "Composer 2.5 Fast",
  "composer-2-5": "Composer 2.5 Standard",
};

export const DEFAULT_MODEL_ID: ModelId = "composer-2-5-fast";

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
