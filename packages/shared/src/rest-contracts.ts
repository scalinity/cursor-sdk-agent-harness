import { z } from "zod";
import { isoDateTimeSchema } from "./constants.js";
import { eventSdkTypeSchema } from "./domain.js";
import {
  agentModeSchema,
  agentStatusSchema,
  mcpValidationStatusSchema,
  modelIdSchema,
  replaySpeedSchema,
  sdkRunStatusSchema,
  settingSourceSchema,
  usageSourceSchema,
} from "./models.js";
import {
  cloudAgentOptionsSchema,
  mcpServerConfigSchema,
  subagentModelSchema,
} from "./sdk-surface.js";

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
});
export type UpdateAgentRequest = z.infer<typeof updateAgentRequestSchema>;

export const agentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: agentStatusSchema,
  mode: agentModeSchema,
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
  // The Phase 11 implementation will add the rest of these filters
  // (status / modelId / usageSource / hasCost / startedAfter /
  // startedBefore). Until then the API contract advertises only what the
  // route actually applies, so clients can't be misled by silently-
  // ignored filter values. See SDK_VERIFICATION_LEDGER OQ-19.
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
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
  status: sdkRunStatusSchema,
  promptPreview: z.string(),
  modelId: z.string().nullable(),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  costUsdMicros: z.number().int().nonnegative().nullable(),
  usageSource: usageSourceSchema.nullable(),
});
export type RunSummary = z.infer<typeof runSummarySchema>;

export const listRunsResponseSchema = z.object({
  items: z.array(runSummarySchema),
  total: z.number().int().nonnegative(),
});

export const getRunEventsQuerySchema = z.object({
  after_seq: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(2000).default(500),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

// ============================================================================
// Events
// ============================================================================

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
});

export const usageSummaryResponseSchema = z.object({
  totalRuns: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCachedInputTokens: z.number().int().nonnegative(),
  totalReasoningTokens: z.number().int().nonnegative(),
  totalCostUsdMicros: z.number().int().nonnegative(),
  bySource: z.record(usageSourceSchema, z.number().int().nonnegative()),
});

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
});
export type McpServerSummary = z.infer<typeof mcpServerSummarySchema>;

// ============================================================================
// Subagent Definitions — TODO: implement routes in Phase 05
// ============================================================================

export const createSubagentRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  prompt: z.string().min(1),
  model: subagentModelSchema,
  mcpServerIds: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});
export type CreateSubagentRequest = z.infer<typeof createSubagentRequestSchema>;

export const updateSubagentRequestSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateSubagentRequest = z.infer<typeof updateSubagentRequestSchema>;

export const replaceSubagentRequestSchema = createSubagentRequestSchema;

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

// CSRF bootstrap — Phase 05.
export const csrfTokenResponseSchema = z.object({
  token: z.string(),
});
