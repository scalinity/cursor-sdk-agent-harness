import { z } from "zod";
import {
  agentIdSchema,
  callIdSchema,
  eventIdSchema,
  isoDateTimeSchema,
  requestIdSchema,
  runIdSchema,
  SCHEMA_VERSION,
} from "./constants.js";
import {
  agentModeSchema,
  agentStatusSchema,
  mcpValidationStatusSchema,
  sdkRunStatusSchema,
  settingSourceSchema,
  usageSourceSchema,
} from "./models.js";
import {
  cloudAgentOptionsSchema,
  mcpServerConfigSchema,
  subagentModelSchema,
} from "./sdk-surface.js";

// Domain row shapes — these are the camelCase TypeScript projections that
// repositories return after mapping snake_case SQL columns. The full
// snake_case persistence DDL lives in spec §8 and apps/server/src/db/schema.ts.

export const agentRowSchema = z.object({
  id: agentIdSchema,
  name: z.string().min(1),
  status: agentStatusSchema,
  mode: agentModeSchema,
  modelId: z.string().min(1),
  cwd: z.array(z.string()).nullable(),
  settingSources: z.array(settingSourceSchema).nullable(),
  sandboxEnabled: z.boolean().nullable(),
  cloudOptions: cloudAgentOptionsSchema.nullable(),
  mcpServerIds: z.array(z.string()),
  subagentDefinitionIds: z.array(z.string()),
  sdkListSeenAt: isoDateTimeSchema.nullable(),
  lastActiveAt: isoDateTimeSchema.nullable(),
  error: z.unknown().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  terminatedAt: isoDateTimeSchema.nullable(),
});
export type AgentRow = z.infer<typeof agentRowSchema>;

export const runRowSchema = z.object({
  id: runIdSchema,
  agentId: agentIdSchema,
  status: sdkRunStatusSchema,
  promptPreview: z.string(),
  modelId: z.string().nullable(),
  mode: agentModeSchema.nullable(),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  lastSeq: z.number().int().nonnegative(),
  finalText: z.string().nullable(),
  finalResult: z.unknown().nullable(),
  gitMetadata: z.unknown().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  costUsdMicros: z.number().int().nonnegative().nullable(),
  usageSource: usageSourceSchema.nullable(),
  error: z.unknown().nullable(),
  interruptedReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type RunRow = z.infer<typeof runRowSchema>;

// Canonical event — the only thing replay reads. Persisted as one row per
// SDKMessage; payload_json carries the normalized payload, raw_json carries
// the original SDKMessage (subject to retention pruning).
export const eventSdkTypeSchema = z.enum([
  "system",
  "user",
  "assistant",
  "thinking",
  "tool_call",
  "status",
  "task",
  "request",
]);
export type EventSdkType = z.infer<typeof eventSdkTypeSchema>;

export const canonicalEventBaseSchema = z.object({
  event_id: eventIdSchema,
  schema_version: z.literal(SCHEMA_VERSION),
  seq: z.number().int().nonnegative(),
  agent_id: agentIdSchema,
  run_id: runIdSchema,
  occurred_at: isoDateTimeSchema,
  received_at: isoDateTimeSchema,
});
export type CanonicalEventBase = z.infer<typeof canonicalEventBaseSchema>;

export const eventRowSchema = z.object({
  id: eventIdSchema,
  runId: runIdSchema,
  agentId: agentIdSchema,
  seq: z.number().int().nonnegative(),
  schemaVersion: z.literal(SCHEMA_VERSION),
  sdkType: eventSdkTypeSchema,
  kind: z.string(),
  callId: callIdSchema.nullable(),
  requestId: requestIdSchema.nullable(),
  status: z.string().nullable(),
  payload: z.unknown(),
  raw: z.unknown().nullable(),
  payloadBytes: z.number().int().nonnegative(),
  rawBytes: z.number().int().nonnegative(),
  occurredAt: isoDateTimeSchema,
  receivedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});
export type EventRow = z.infer<typeof eventRowSchema>;

export const settingRowSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  description: z.string().nullable(),
  updatedAt: isoDateTimeSchema,
});
export type SettingRow = z.infer<typeof settingRowSchema>;

export const mcpServerRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  config: mcpServerConfigSchema,
  validationStatus: mcpValidationStatusSchema,
  validationMessage: z.string().nullable(),
  lastStatus: z.string().nullable(),
  lastCheckedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type McpServerRow = z.infer<typeof mcpServerRowSchema>;

export const subagentDefinitionRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  description: z.string(),
  prompt: z.string(),
  model: subagentModelSchema,
  mcpServerIds: z.array(z.string()),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type SubagentDefinitionRow = z.infer<typeof subagentDefinitionRowSchema>;

export const workspaceAllowlistRowSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  label: z.string().nullable(),
  recursive: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  lastUsedAt: isoDateTimeSchema.nullable(),
});
export type WorkspaceAllowlistRow = z.infer<typeof workspaceAllowlistRowSchema>;

// Run-interrupted reasons. Used by both event payloads and run.interrupted_reason.
// TokenUsage lives in sdk-surface.ts — consumers import it from the package
// root or directly from sdk-surface; do not re-export through domain.ts.
export const runInterruptedReasonSchema = z.enum([
  "user_cancelled",
  "server_restart",
  "server_close",
  "agent_terminated",
  "stream_error",
]);
export type RunInterruptedReason = z.infer<typeof runInterruptedReasonSchema>;
