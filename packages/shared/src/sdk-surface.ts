import { z } from "zod";
import {
  agentIdSchema,
  callIdSchema,
  requestIdSchema,
  runIdSchema,
} from "./constants.js";
import { sdkRunStatusSchema } from "./models.js";

// SDK surface types — mirror the discriminated union that arrives off
// run.stream() AsyncGenerator<SDKMessage>. The shape here is the spec §7
// transport contract. See SDK_VERIFICATION_LEDGER.md OQ-06..OQ-09 for the
// underlying `messages.d.ts` shapes that informed these schemas.

export const modelSelectionSchema = z.object({
  id: z.string(),
});
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const textBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});
export type TextBlock = z.infer<typeof textBlockSchema>;

export const toolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});
export type ToolUseBlock = z.infer<typeof toolUseBlockSchema>;

const baseAgentRunFields = {
  agent_id: agentIdSchema,
  run_id: runIdSchema,
} as const;

export const systemSdkMessageSchema = z.object({
  type: z.literal("system"),
  subtype: z.literal("init").optional(),
  ...baseAgentRunFields,
  model: modelSelectionSchema.optional(),
  tools: z.array(z.string()).optional(),
});

export const userSdkMessageSchema = z.object({
  type: z.literal("user"),
  ...baseAgentRunFields,
  message: z.object({
    role: z.literal("user"),
    content: z.array(textBlockSchema),
  }),
});

export const assistantSdkMessageSchema = z.object({
  type: z.literal("assistant"),
  ...baseAgentRunFields,
  message: z.object({
    role: z.literal("assistant"),
    content: z.array(z.union([textBlockSchema, toolUseBlockSchema])),
  }),
});

export const thinkingSdkMessageSchema = z.object({
  type: z.literal("thinking"),
  ...baseAgentRunFields,
  text: z.string(),
  thinking_duration_ms: z.number().int().nonnegative().optional(),
});

export const toolCallSdkMessageSchema = z.object({
  type: z.literal("tool_call"),
  ...baseAgentRunFields,
  call_id: callIdSchema,
  name: z.string(),
  status: z.enum(["running", "completed", "error"]),
  args: z.unknown().optional(),
  result: z.unknown().optional(),
  truncated: z
    .object({
      args: z.boolean().optional(),
      result: z.boolean().optional(),
    })
    .optional(),
});

export const statusSdkMessageSchema = z.object({
  type: z.literal("status"),
  ...baseAgentRunFields,
  status: sdkRunStatusSchema,
  message: z.string().optional(),
});

export const taskSdkMessageSchema = z.object({
  type: z.literal("task"),
  ...baseAgentRunFields,
  status: z.string().optional(),
  text: z.string().optional(),
});

export const requestSdkMessageSchema = z.object({
  type: z.literal("request"),
  ...baseAgentRunFields,
  request_id: requestIdSchema,
});

export const sdkMessageSchema = z.discriminatedUnion("type", [
  systemSdkMessageSchema,
  userSdkMessageSchema,
  assistantSdkMessageSchema,
  thinkingSdkMessageSchema,
  toolCallSdkMessageSchema,
  statusSdkMessageSchema,
  taskSdkMessageSchema,
  requestSdkMessageSchema,
]);
export type SDKMessage = z.infer<typeof sdkMessageSchema>;

// Token usage rides on the TurnEndedUpdate.usage delta event delivered via
// SendOptions.onDelta, not on RunResult. See OQ-02..OQ-04 in the ledger.
export const tokenUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative().nullable(),
  cached_input_tokens: z.number().int().nonnegative().nullable(),
  reasoning_tokens: z.number().int().nonnegative().nullable(),
  cost_usd_micros: z.number().int().nonnegative().nullable(),
  usage_source: z.enum(["sdk_final_result", "derived", "unavailable"]),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

// CloudAgentOptions — verbatim from OQ-16. Used by Agent.create({ cloud })
// and persisted on the agents row as cloud_options_json when mode = "cloud".
export const cloudAgentOptionsSchema = z.object({
  env: z
    .object({
      type: z.enum(["cloud", "pool", "machine"]),
      name: z.string().optional(),
    })
    .optional(),
  repos: z
    .array(
      z.object({
        url: z.string(),
        startingRef: z.string().optional(),
        prUrl: z.string().optional(),
      }),
    )
    .optional(),
  workOnCurrentBranch: z.boolean().optional(),
  autoCreatePR: z.boolean().optional(),
  skipReviewerRequest: z.boolean().optional(),
  envVars: z.record(z.string()).optional(),
});
export type CloudAgentOptions = z.infer<typeof cloudAgentOptionsSchema>;

// McpServerConfig — verbatim from OQ-18. Discriminated by which transport
// field is present. `type` is optional but recommended; we normalize at
// write time so persisted rows always carry it.
const mcpStdioConfigSchema = z.object({
  type: z.literal("stdio").optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

const mcpHttpConfigSchema = z.object({
  type: z.enum(["http", "sse"]).optional(),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  auth: z
    .object({
      CLIENT_ID: z.string(),
      CLIENT_SECRET: z.string().optional(),
      scopes: z.array(z.string()).optional(),
    })
    .optional(),
});

export const mcpServerConfigSchema = z.union([
  mcpStdioConfigSchema,
  mcpHttpConfigSchema,
]);
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

// Subagent definition model selector. Mirrors AgentOptions.agents[*].model
// — the SDK accepts `ModelSelection | "inherit"` (verified against
// options.d.ts AgentDefinition). The harness persists this as either
// `{ id }` for an explicit override, or `null` for inherit.
export const subagentModelSchema = z.object({
  id: z.string().min(1),
});
export type SubagentModel = z.infer<typeof subagentModelSchema>;

/**
 * Model override on a subagent definition. `null` means "inherit the
 * parent agent's model"; an object means "override with this model id".
 *
 * The SDK exposes the same choice as `ModelSelection | "inherit"` on
 * `AgentDefinition.model`; the harness translation step in
 * `agent-options-builder` omits the field entirely when `null`, since the
 * SDK already treats an absent `model` as "inherit".
 */
export const subagentModelOverrideSchema = subagentModelSchema.nullable();
export type SubagentModelOverride = z.infer<typeof subagentModelOverrideSchema>;
