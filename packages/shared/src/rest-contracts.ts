import { z } from "zod";
import { isoDateTimeSchema, MAX_IMAGE_ATTACHMENTS } from "./constants.js";
import { eventSdkTypeSchema } from "./domain.js";
import {
  agentModeSchema,
  agentStatusSchema,
  executionModeSchema,
  mcpValidationStatusSchema,
  modelIdSchema,
  replaySpeedSchema,
  sdkRunStatusSchema,
  settingSourceSchema,
  usageSourceSchema,
} from "./models.js";
import { serverFrameSchema } from "./ws-protocol.js";
import {
  cloudAgentOptionsSchema,
  mcpServerConfigSchema,
  subagentModelOverrideSchema,
  tokenUsageSchema,
} from "./sdk-surface.js";
import { workspaceAllowlistRowSchema, sdkImageSchema } from "./domain.js";

// REST request/response contracts. Each route block below is paired with the
// spec §4 REST endpoint list. Routes that have not yet been implemented are
// tagged with `// TODO: implement in Phase NN`; the schemas themselves are
// stable so phases consuming them later don't need to rewrite shapes.

// ============================================================================
// Health
// ============================================================================

export const healthLiveResponseSchema = z.object({
  status: z.literal("ok"),
});

export const healthReadyResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.object({
    db: z.enum(["ok", "skipped", "error"]),
    keychain: z.enum(["ok", "skipped", "error"]),
    migrations: z.enum(["ok", "pending", "error"]).optional(),
    settings: z.enum(["ok", "pending", "error"]).optional(),
  }),
});

export const healthVersionResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  phase: z.string().optional(),
  protocolVersion: z.number().int().optional(),
  schemaVersion: z.number().int().optional(),
});

// ============================================================================
// Agents — TODO: implement routes in Phase 06 / Phase 07
// ============================================================================

export const createAgentRequestSchema = z
  .object({
    name: z.string().min(1).max(256),
    mode: agentModeSchema,
    modelId: modelIdSchema,
    cwd: z.array(z.string().min(1)).optional(),
    settingSources: z.array(settingSourceSchema).optional(),
    sandboxEnabled: z.boolean().optional(),
    cloudOptions: cloudAgentOptionsSchema.optional(),
    mcpServerIds: z.array(z.string()).default([]),
    subagentDefinitionIds: z.array(z.string()).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "local") {
      if (!value.cwd || value.cwd.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cwd"],
          message: "Local agents require at least one cwd path.",
        });
      }
    } else if (value.mode === "cloud") {
      if (!value.cloudOptions) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cloudOptions"],
          message: "Cloud agents require a cloudOptions object.",
        });
      }
    }
    if (value.settingSources && value.settingSources.includes("all") && value.settingSources.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["settingSources"],
        message: "settingSources `all` is mutually exclusive with other sources.",
      });
    }
  });
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;

export const updateAgentRequestSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  executionMode: executionModeSchema.optional(),
});
export type UpdateAgentRequest = z.infer<typeof updateAgentRequestSchema>;

export const agentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: agentStatusSchema,
  mode: agentModeSchema,
  executionMode: executionModeSchema,
  modelId: z.string(),
  runCount: z.number().int().nonnegative(),
  activeRunCount: z.number().int().nonnegative(),
  totalCostUsdMicros: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  lastActiveAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  terminatedAt: isoDateTimeSchema.nullable(),
});
export type AgentSummary = z.infer<typeof agentSummarySchema>;

export const listAgentsResponseSchema = z.object({
  items: z.array(agentSummarySchema),
});

export const agentDetailResponseSchema = agentSummarySchema.extend({
  cwd: z.array(z.string()).nullable(),
  settingSources: z.array(settingSourceSchema).nullable(),
  sandboxEnabled: z.boolean().nullable(),
  cloudOptions: cloudAgentOptionsSchema.nullable(),
  mcpServerIds: z.array(z.string()),
  subagentDefinitionIds: z.array(z.string()),
  latestRunId: z.string().nullable(),
  latestRunStatus: sdkRunStatusSchema.nullable(),
});
export type AgentDetailResponse = z.infer<typeof agentDetailResponseSchema>;

export const createRunRequestSchema = z.object({
  agentId: z.string().min(1),
  prompt: z.string().min(1).max(64_000),
  executionMode: executionModeSchema.optional(),
  images: z.array(sdkImageSchema).max(MAX_IMAGE_ATTACHMENTS).optional(),
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export const createRunResponseSchema = z.object({
  runId: z.string(),
  agentId: z.string(),
  status: sdkRunStatusSchema,
  startedAt: isoDateTimeSchema,
});
export type CreateRunResponse = z.infer<typeof createRunResponseSchema>;

// Standard error code envelope used by Phase 06 routes. Routes may augment
// the body with extra context fields (e.g. `normalizedPath`); the `code`
// discriminator is stable.
export const errorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

// ============================================================================
// Runs — TODO: implement routes in Phase 07 / Phase 11
// ============================================================================

// Query-string variants. Use z.coerce.number() because Fastify query
// params arrive as strings; the schema accepts `?limit=50` and coerces
// to a number, rejecting NaN/non-numeric strings with a Zod issue.
export const listRunsQuerySchema = z.object({
  agentId: z.string().optional(),
  status: z.string().optional(),
  modelId: z.string().optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  hasCost: z.enum(["any", "available", "unavailable", "none"]).default("any"),
  sort: z
    .enum([
      "started_desc",
      "started_asc",
      "duration_desc",
      "duration_asc",
      "cost_desc",
      "cost_asc",
      "tokens_desc",
      "tokens_asc",
    ])
    .default("started_desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;

export const listAgentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListAgentsQuery = z.infer<typeof listAgentsQuerySchema>;

export const runSummarySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  agentName: z.string().nullable(),
  name: z.string().nullable(),
  status: sdkRunStatusSchema,
  executionMode: executionModeSchema.nullable(),
  promptPreview: z.string(),
  modelId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  costUsdMicros: z.number().int().nonnegative().nullable(),
  usageSource: usageSourceSchema.nullable(),
  toolCallCount: z.number().int().nonnegative(),
  errorToolCallCount: z.number().int().nonnegative(),
});
export type RunSummary = z.infer<typeof runSummarySchema>;

export const listRunsResponseSchema = z.object({
  items: z.array(runSummarySchema),
  total: z.number().int().nonnegative(),
});

export const getRunEventsQuerySchema = z.object({
  after_seq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

export const getRunEventsResponseSchema = z.object({
  items: z.array(serverFrameSchema),
  total: z.number().int().nonnegative(),
  nextAfterSeq: z.number().int().nonnegative().nullable(),
});
export type GetRunEventsResponse = z.infer<typeof getRunEventsResponseSchema>;

export const canonicalTranscriptEventSchema = z.object({
  event_id: z.string(),
  schema_version: z.literal(1),
  seq: z.number().int().nonnegative(),
  agent_id: z.string(),
  run_id: z.string(),
  occurred_at: isoDateTimeSchema,
  received_at: isoDateTimeSchema,
  sdk_type: eventSdkTypeSchema,
  kind: z.string(),
  payload: z.unknown(),
});
export type CanonicalTranscriptEvent = z.infer<typeof canonicalTranscriptEventSchema>;

export const transcriptResponseSchema = z.object({
  run: z.object({
    id: z.string(),
    agentId: z.string(),
    status: sdkRunStatusSchema,
    startedAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    modelId: z.string().nullable(),
    promptPreview: z.string(),
    usage: tokenUsageSchema,
    finalText: z.string().nullable(),
    gitMetadata: z.unknown(),
  }),
  agent: z.object({ id: z.string(), name: z.string(), mode: agentModeSchema }),
  events: z.array(canonicalTranscriptEventSchema),
  schemaVersion: z.literal(1),
  exportedAt: isoDateTimeSchema,
});
export type TranscriptResponse = z.infer<typeof transcriptResponseSchema>;

// ============================================================================
// Events
// ============================================================================

export const eventPayloadResponseSchema = z.object({
  value: z.unknown(),
});
export type EventPayloadResponse = z.infer<typeof eventPayloadResponseSchema>;

export const largePayloadFieldSchema = z.enum(["args", "result", "raw"]);
export type LargePayloadField = z.infer<typeof largePayloadFieldSchema>;

export const eventLargePayloadResponseSchema = z.object({
  value: z.unknown(),
  byteCount: z.number().int().nonnegative(),
});
export type EventLargePayloadResponse = z.infer<typeof eventLargePayloadResponseSchema>;

export const eventEnvelopeSchema = z.object({
  id: z.string(),
  runId: z.string(),
  agentId: z.string(),
  seq: z.number().int().nonnegative(),
  sdkType: eventSdkTypeSchema,
  kind: z.string(),
  callId: z.string().nullable(),
  requestId: z.string().nullable(),
  status: z.string().nullable(),
  payload: z.unknown(),
  occurredAt: isoDateTimeSchema,
  receivedAt: isoDateTimeSchema,
});

// ============================================================================
// Settings
// ============================================================================

export const settingsSnapshotSchema = z.object({
  defaultModelId: modelIdSchema,
  defaultExecutionMode: executionModeSchema,
  defaultSettingSources: z.array(settingSourceSchema),
  sandboxEnabledByDefault: z.boolean(),
  defaultReplaySpeed: replaySpeedSchema,
  rawEventRetentionDays: z.number().int().min(1).max(3650),
  pricing: z.object({
    composer25Fast: z.object({
      inputPerMillionUsdMicros: z.number().int().nonnegative(),
      outputPerMillionUsdMicros: z.number().int().nonnegative(),
      cachedInputPerMillionUsdMicros: z.number().int().nonnegative(),
    }),
    composer25: z.object({
      inputPerMillionUsdMicros: z.number().int().nonnegative(),
      outputPerMillionUsdMicros: z.number().int().nonnegative(),
      cachedInputPerMillionUsdMicros: z.number().int().nonnegative(),
    }),
    promoMultiplier: z.number().min(0).max(1),
    lastVerifiedAt: isoDateTimeSchema.nullable(),
  }),
});
export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;

export const updateSettingsRequestSchema = z.object({
  defaultModelId: modelIdSchema.optional(),
  defaultExecutionMode: executionModeSchema.optional(),
  defaultSettingSources: z.array(settingSourceSchema).optional(),
  sandboxEnabledByDefault: z.boolean().optional(),
  defaultReplaySpeed: replaySpeedSchema.optional(),
  rawEventRetentionDays: z.number().int().min(1).max(3650).optional(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

export const updatePricingRequestSchema = z.object({
  composer25Fast: z
    .object({
      inputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
      outputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
      cachedInputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
    })
    .optional(),
  composer25: z
    .object({
      inputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
      outputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
      cachedInputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
    })
    .optional(),
  promoMultiplier: z.number().min(0).max(1).optional(),
  markVerified: z.boolean().optional(),
});
export type UpdatePricingRequest = z.infer<typeof updatePricingRequestSchema>;

export const apiKeyPresenceResponseSchema = z.object({
  present: z.boolean(),
  lastValidatedAt: isoDateTimeSchema.nullable().optional(),
});

export const setApiKeyRequestSchema = z.object({
  value: z.string().min(8).max(512),
});
export type SetApiKeyRequest = z.infer<typeof setApiKeyRequestSchema>;

// ============================================================================
// Usage — TODO: implement routes in Phase 11
// ============================================================================

export const usageDateRangeQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  agentId: z.string().optional(),
  modelId: z.string().optional(),
});

export const pricingFreshnessSchema = z.object({
  lastVerifiedAt: isoDateTimeSchema.nullable(),
  staleness: z.enum(["fresh", "stale", "never_verified"]),
});
export type PricingFreshness = z.infer<typeof pricingFreshnessSchema>;

export const usageSummaryResponseSchema = z.object({
  totalRuns: z.number().int().nonnegative(),
  totalCost: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  unavailableCount: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCachedInputTokens: z.number().int().nonnegative(),
  totalReasoningTokens: z.number().int().nonnegative(),
  totalCostUsdMicros: z.number().int().nonnegative(),
  bySource: z.record(usageSourceSchema, z.number().int().nonnegative()),
  pricingFreshness: pricingFreshnessSchema,
});
export type UsageSummary = z.infer<typeof usageSummaryResponseSchema>;

export const usageDailyPointSchema = z.object({
  date: z.string(),
  cost: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
});
export const usageDailyResponseSchema = z.array(usageDailyPointSchema);
export type UsageDailyPoint = z.infer<typeof usageDailyPointSchema>;

export const usageBreakdownRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  runs: z.number().int().nonnegative(),
  cost: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
});
export const usageBreakdownResponseSchema = z.object({
  items: z.array(usageBreakdownRowSchema),
});
export type UsageBreakdownRow = z.infer<typeof usageBreakdownRowSchema>;

// ============================================================================
// MCP Servers — TODO: implement routes in Phase 05
// ============================================================================

export const createMcpServerRequestSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  config: mcpServerConfigSchema,
});
export type CreateMcpServerRequest = z.infer<typeof createMcpServerRequestSchema>;

export const updateMcpServerRequestSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateMcpServerRequest = z.infer<typeof updateMcpServerRequestSchema>;

export const replaceMcpServerRequestSchema = createMcpServerRequestSchema;

export const mcpServerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  validationStatus: mcpValidationStatusSchema,
  validationMessage: z.string().nullable(),
  lastStatus: z.string().nullable(),
  lastCheckedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  /**
   * The config with token-like fields replaced by the `[REDACTED]` sentinel.
   * Spec §5 MCP Server CRUD requires the list view to never carry raw
   * secrets — the editor dialog fetches the raw value via the per-server
   * reveal endpoint.
   */
  configRedacted: mcpServerConfigSchema,
  /**
   * Discriminator that lets the UI render the right form. `stdio` for
   * command-line transports, `http`/`sse` for URL transports.
   */
  transport: z.enum(["stdio", "http", "sse"]),
});
export type McpServerSummary = z.infer<typeof mcpServerSummarySchema>;

export const listMcpServersResponseSchema = z.object({
  items: z.array(mcpServerSummarySchema),
});
export type ListMcpServersResponse = z.infer<typeof listMcpServersResponseSchema>;

/**
 * Editor-only response — the unredacted config. Returned by
 * `GET /api/mcp-servers/:id/reveal`. The reveal endpoint is rate-limited
 * to one request per second per server in the route handler.
 */
export const mcpServerRevealResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  config: mcpServerConfigSchema,
});
export type McpServerRevealResponse = z.infer<typeof mcpServerRevealResponseSchema>;

// ============================================================================
// Subagent Definitions — TODO: implement routes in Phase 05
// ============================================================================

export const createSubagentRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  prompt: z.string().min(1),
  // `null` ⇒ inherit the parent agent's model (spec §5 Subagent CRUD).
  // `{ id }` ⇒ explicit per-subagent override.
  model: subagentModelOverrideSchema,
  mcpServerIds: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});
export type CreateSubagentRequest = z.infer<typeof createSubagentRequestSchema>;

export const updateSubagentRequestSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  description: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  model: subagentModelOverrideSchema.optional(),
  mcpServerIds: z.array(z.string()).optional(),
});
export type UpdateSubagentRequest = z.infer<typeof updateSubagentRequestSchema>;

export const replaceSubagentRequestSchema = createSubagentRequestSchema;
export type ReplaceSubagentRequest = z.infer<typeof replaceSubagentRequestSchema>;

export const subagentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  description: z.string(),
  prompt: z.string(),
  model: subagentModelOverrideSchema,
  mcpServerIds: z.array(z.string()),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type SubagentSummary = z.infer<typeof subagentSummarySchema>;

export const listSubagentsResponseSchema = z.object({
  items: z.array(subagentSummarySchema),
});
export type ListSubagentsResponse = z.infer<typeof listSubagentsResponseSchema>;

// ============================================================================
// Workspace Allowlist — TODO: implement routes in Phase 05
// ============================================================================

export const createWorkspaceAllowlistRequestSchema = z.object({
  path: z.string().min(1),
  label: z.string().nullable().optional(),
  recursive: z.boolean().default(true),
});
export type CreateWorkspaceAllowlistRequest = z.infer<
  typeof createWorkspaceAllowlistRequestSchema
>;

export const validateWorkspacePathRequestSchema = z.object({
  path: z.string().min(1),
});

export const validateWorkspacePathResponseSchema = z.discriminatedUnion("allowed", [
  z.object({
    allowed: z.literal(true),
    matchedEntryId: z.string(),
    normalizedPath: z.string(),
  }),
  z.object({
    allowed: z.literal(false),
    normalizedPath: z.string(),
    reason: z.enum(["not_allowlisted", "missing", "symlink_escape"]),
  }),
]);

// Phase 16 — active workspace.
// The active workspace id is persisted in `settings` under
// the key `app.activeWorkspaceId` so it survives across launches.
// It must reference an existing `workspace_allowlist.id` (verified
// at write time; FK is best-effort because the settings table
// stores arbitrary JSON values).
export const activeWorkspaceResponseSchema = z.object({
  activeWorkspaceId: z.string().nullable(),
  workspace: workspaceAllowlistRowSchema.nullable(),
});
export type ActiveWorkspaceResponse = z.infer<typeof activeWorkspaceResponseSchema>;

export const setActiveWorkspaceRequestSchema = z.object({
  id: z.string().nullable(),
});
export type SetActiveWorkspaceRequest = z.infer<typeof setActiveWorkspaceRequestSchema>;

// ============================================================================
// Phase 19 — Git Status
// ============================================================================

export const gitStatusResponseSchema = z.object({
  isGitRepo: z.boolean(),
  branch: z.string().nullable(),
  isDirty: z.boolean(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
});
export type GitStatusResponse = z.infer<typeof gitStatusResponseSchema>;

// ============================================================================
// Phase 19 — File Write (Apply to File)
// ============================================================================

export const fileWriteRequestSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  workspaceId: z.string().optional(),
});
export type FileWriteRequest = z.infer<typeof fileWriteRequestSchema>;

export const fileWriteResponseSchema = z.object({
  absolutePath: z.string(),
  bytesWritten: z.number().int().nonnegative(),
});
export type FileWriteResponse = z.infer<typeof fileWriteResponseSchema>;

// ============================================================================
// Phase 19 — Run Search (FTS)
// ============================================================================

export const runSearchQuerySchema = z.object({
  q: z.string().min(2).max(500),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type RunSearchQuery = z.infer<typeof runSearchQuerySchema>;

export const runSearchResultSchema = z.object({
  results: z.array(
    z.object({
      runId: z.string(),
      name: z.string().nullable(),
      prompt: z.string(),
      snippet: z.string(),
      rank: z.number(),
      createdAt: isoDateTimeSchema,
      agentId: z.string(),
      executionMode: executionModeSchema.nullable(),
      status: sdkRunStatusSchema,
    }),
  ),
});
export type RunSearchResult = z.infer<typeof runSearchResultSchema>;

// ============================================================================
// Phase 19 — Run Rename
// ============================================================================

export const runPatchSchema = z.object({
  name: z.string().max(200).optional(),
});
export type RunPatch = z.infer<typeof runPatchSchema>;

// CSRF bootstrap — Phase 05.
export const csrfTokenResponseSchema = z.object({
  token: z.string(),
});
