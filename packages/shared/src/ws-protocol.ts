import { z } from "zod";
import {
  agentIdSchema,
  callIdSchema,
  eventIdSchema,
  frameIdSchema,
  isoDateTimeSchema,
  requestIdSchema,
  runIdSchema,
  MAX_IMAGE_ATTACHMENTS,
} from "./constants.js";
import { modelIdSchema, replaySpeedSchema, sdkRunStatusSchema, settingSourceSchema, knownLanguageSchema } from "./models.js";
import { canonicalEventBaseSchema, runInterruptedReasonSchema, sdkImageSchema } from "./domain.js";
import { tokenUsageSchema } from "./sdk-surface.js";

export const frameBaseSchema = z.object({
  id: frameIdSchema,
  type: z.string(),
  sent_at: isoDateTimeSchema,
  /**
   * Set to `true` for server-emitted event frames that represent
   * historical replay (i.e. events fetched out of SQLite during
   * `subscribe_run` with `after_seq > 0`). Live frames omit the field
   * (Zod default keeps it optional). Spec §4 reconnection contract
   * uses this for client-side autoscroll decisions: the UI should
   * jump-without-animation through replayed frames and animate live
   * ones.
   */
  replayed: z.boolean().optional(),
});

// -- Client → Server frames -------------------------------------------------

export const subscribeRunFrameSchema = frameBaseSchema.extend({
  type: z.literal("subscribe_run"),
  run_id: runIdSchema,
  after_seq: z.number().int().nonnegative().default(0),
  replay: z
    .object({
      enabled: z.boolean().default(true),
      speed: replaySpeedSchema.default("instant"),
    })
    .default({ enabled: true, speed: "instant" }),
});

export const unsubscribeRunFrameSchema = frameBaseSchema.extend({
  type: z.literal("unsubscribe_run"),
  run_id: runIdSchema,
});

export const submitUserInputFrameSchema = frameBaseSchema.extend({
  type: z.literal("submit_user_input"),
  agent_id: agentIdSchema,
  prompt: z.string().min(1).max(200_000),
  images: z.array(sdkImageSchema).max(MAX_IMAGE_ATTACHMENTS).optional(),
  client_run_id: z.string().uuid().optional(),
});

export const cancelRunFrameSchema = frameBaseSchema.extend({
  type: z.literal("cancel_run"),
  run_id: runIdSchema,
  reason: z.string().max(1_000).optional(),
});

export const deleteRunFrameSchema = frameBaseSchema.extend({
  type: z.literal("delete_run"),
  run_id: runIdSchema,
});

export const updateSettingsFrameSchema = frameBaseSchema.extend({
  type: z.literal("update_settings"),
  patch: z.object({
    defaultModelId: modelIdSchema.optional(),
    defaultSettingSources: z.array(settingSourceSchema).optional(),
    sandboxEnabledByDefault: z.boolean().optional(),
    defaultReplaySpeed: replaySpeedSchema.optional(),
    rawEventRetentionDays: z.number().int().min(1).max(3650).optional(),

    pricingComposer25FastInputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
    pricingComposer25FastOutputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
    pricingComposer25FastCachedInputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
    pricingComposer25InputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
    pricingComposer25OutputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
    pricingComposer25CachedInputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
    pricingPromoMultiplier: z.number().min(0).max(1).optional(),
    pricingLastVerifiedAt: isoDateTimeSchema.nullable().optional(),
  }),
});

export const approvalResponseFrameSchema = frameBaseSchema.extend({
  type: z.literal("approval_response"),
  run_id: runIdSchema,
  request_id: requestIdSchema,
  decision: z.enum(["approve", "deny"]),
  reason: z.string().max(2_000).optional(),
  // RV2-S5: payload was optional and unused. Dropped to prevent
  // clients shoveling arbitrary data through; if a future protocol
  // needs structured response data, add it back with an explicit
  // schema, not z.unknown().
});

export const clientHeartbeatFrameSchema = frameBaseSchema.extend({
  type: z.literal("heartbeat_ack"),
  server_heartbeat_id: frameIdSchema,
});

export const clientFrameSchema = z.discriminatedUnion("type", [
  subscribeRunFrameSchema,
  unsubscribeRunFrameSchema,
  submitUserInputFrameSchema,
  cancelRunFrameSchema,
  deleteRunFrameSchema,
  updateSettingsFrameSchema,
  approvalResponseFrameSchema,
  clientHeartbeatFrameSchema,
]);
export type ClientFrame = z.infer<typeof clientFrameSchema>;

// -- Server → Client frames -------------------------------------------------

export const wsErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHORIZED_ORIGIN",
  "CSRF_FAILED",
  "AGENT_NOT_FOUND",
  "RUN_NOT_FOUND",
  "SDK_ERROR",
  "KEYCHAIN_ERROR",
  "WORKSPACE_NOT_ALLOWED",
  "INVALID_RESUME_CURSOR",
  "APPROVAL_NOT_PENDING",
  "APPROVAL_UNIMPLEMENTED",
  "CANCEL_UNAVAILABLE",
  "USAGE_PARSE_FAILED",
  "PRICING_NOT_CONFIGURED",
  "INTERNAL_ERROR",
]);
export type WsErrorCode = z.infer<typeof wsErrorCodeSchema>;

export const ackFrameSchema = frameBaseSchema.extend({
  type: z.literal("ack"),
  ack_for: frameIdSchema,
  ok: z.literal(true),
  message: z.string().optional(),
  replay_complete: z.boolean().optional(),
});

export const errorFrameSchema = frameBaseSchema.extend({
  type: z.literal("error"),
  ack_for: frameIdSchema.optional(),
  code: wsErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
  retryable: z.boolean().default(false),
});

export const serverHeartbeatFrameSchema = frameBaseSchema.extend({
  type: z.literal("heartbeat"),
  heartbeat_id: frameIdSchema,
  server_time: isoDateTimeSchema,
});

// -- SDK and derived event frames -------------------------------------------

const systemInitEventSchema = canonicalEventBaseSchema.extend({
  sdk_type: z.literal("system"),
  kind: z.literal("system.init"),
  payload: z.object({
    subtype: z.literal("init").optional(),
    model: z.object({ id: z.string() }).optional(),
    tools: z.array(z.string()).optional(),
    mode: z.enum(["local", "cloud"]),
    cwd: z.array(z.string()).optional(),
    sandbox_enabled: z.boolean().optional(),
  }),
});

const systemCancelUnavailableEventSchema = canonicalEventBaseSchema.extend({
  sdk_type: z.literal("system"),
  kind: z.literal("system.cancel_unavailable"),
  payload: z.object({
    unsupported_reason: z.string().optional(),
  }),
});

export const systemEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.system"),
  event: z.discriminatedUnion("kind", [
    systemInitEventSchema,
    systemCancelUnavailableEventSchema,
  ]),
});

export const userEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.user"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("user"),
    kind: z.literal("user.message"),
    payload: z.object({
      role: z.literal("user"),
      content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
    }),
  }),
});

export const assistantEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.assistant"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("assistant"),
    kind: z.union([z.literal("assistant.delta"), z.literal("assistant.snapshot")]),
    payload: z.object({
      role: z.literal("assistant"),
      text_delta: z.string().optional(),
      full_text_length: z.number().int().nonnegative().optional(),
      is_replacement: z.boolean().default(false),
      tool_uses: z
        .array(z.object({ id: z.string(), name: z.string(), input: z.unknown() }))
        .default([]),
    }),
  }),
});

export const thinkingEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.thinking"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("thinking"),
    kind: z.union([z.literal("thinking.delta"), z.literal("thinking.snapshot")]),
    payload: z.object({
      text_delta: z.string(),
      full_text_length: z.number().int().nonnegative(),
      is_replacement: z.boolean().default(false),
      thinking_duration_ms: z.number().int().nonnegative().optional(),
    }),
  }),
});

export const toolCallEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.tool_call"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("tool_call"),
    kind: z.enum(["tool_call.running", "tool_call.completed", "tool_call.error"]),
    payload: z.object({
      call_id: callIdSchema,
      name: z.string(),
      status: z.enum(["running", "completed", "error"]),
      args: z.unknown().optional(),
      result: z.unknown().optional(),
      truncated: z
        .object({ args: z.boolean().optional(), result: z.boolean().optional() })
        .optional(),
      large_payload_refs: z
        .object({
          args_event_url: z.string().optional(),
          result_event_url: z.string().optional(),
          raw_event_url: z.string().optional(),
        })
        .optional(),
      timing: z
        .object({
          started_at: isoDateTimeSchema.optional(),
          completed_at: isoDateTimeSchema.optional(),
          duration_ms: z.number().int().nonnegative().optional(),
        })
        .optional(),
    }),
  }),
});

export const statusEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.status"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("status"),
    kind: z.literal("status.changed"),
    payload: z.object({ status: sdkRunStatusSchema, message: z.string().optional() }),
  }),
});

export const taskEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.task"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("task"),
    kind: z.literal("task.updated"),
    payload: z.object({ status: z.string().optional(), text: z.string().optional() }),
  }),
});

export const subagentLifecyclePayloadSchema = z.object({
  parent_run_id: runIdSchema,
  child_run_id: runIdSchema,
  subagent_name: z.string().trim().min(1).max(256),
  source_call_id: callIdSchema,
  status: sdkRunStatusSchema.optional(),
});

export const subagentSpawnedFrameSchema = frameBaseSchema.extend({
  type: z.literal("subagent_spawned"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("task"),
    kind: z.literal("subagent.spawned"),
    payload: subagentLifecyclePayloadSchema.extend({
      status: z.literal("RUNNING").optional(),
    }),
  }),
});

export const subagentCompletedFrameSchema = frameBaseSchema.extend({
  type: z.literal("subagent_completed"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("task"),
    kind: z.literal("subagent.completed"),
    payload: subagentLifecyclePayloadSchema.extend({
      status: z.enum(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]),
    }),
  }),
});

export const requestEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.request"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("request"),
    kind: z.literal("request.created"),
    payload: z.object({
      request_id: requestIdSchema,
      context_event_ids: z.array(eventIdSchema).default([]),
      inferred_reason: z.string().nullable().default(null),
    }),
  }),
});

export const codeEditOperationSchema = z.object({
  type: z.enum(["insert", "delete", "replace"]),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  text: z.string(),
});

export const codeEditDetectedPayloadSchema = z.object({
  source_call_id: callIdSchema,
  confidence: z.enum(["high", "medium", "low"]),
  edits: z.array(
    z.object({
      path: z.string(),
      language: knownLanguageSchema.nullable(),
      before: z.string().optional(),
      after: z.string().optional(),
      unifiedDiff: z.string().optional(),
      operations: z.array(codeEditOperationSchema),
    }),
  ),
});

export const codeEditDetectedFrameSchema = frameBaseSchema.extend({
  type: z.literal("derived.code_edit"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("tool_call"),
    kind: z.literal("code_edit.detected"),
    payload: codeEditDetectedPayloadSchema,
  }),
});

export const runFinalResultFrameSchema = frameBaseSchema.extend({
  type: z.literal("run.final_result"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("status"),
    kind: z.literal("run.final_result"),
    payload: z.object({
      text: z.string().optional(),
      model: z.unknown().optional(),
      duration_ms: z.number().int().nonnegative().optional(),
      git_metadata: z.unknown().optional(),
      usage: tokenUsageSchema,
      usage_parse_error: z
        .object({ message: z.string(), raw_shape: z.unknown().optional() })
        .optional(),
    }),
  }),
});

export const runInterruptedFrameSchema = frameBaseSchema.extend({
  type: z.literal("run.interrupted"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("status"),
    kind: z.literal("run.interrupted"),
    payload: z.object({
      reason: runInterruptedReasonSchema,
      message: z.string().optional(),
    }),
  }),
});

// Phase 13 — approval outcome frames. The payload mirrors the original
// `approval_response` client frame so the timeline can render exactly
// what the user clicked, plus a `resolved_at` ISO stamp and an optional
// failure `code`. `code = "APPROVAL_UNIMPLEMENTED"` is the OQ-10 branch:
// the SDK in v1.0.13 exposes no resolution method and the harness must
// be honest about that rather than fake a resolved request.
export const approvalResolvedFrameSchema = frameBaseSchema.extend({
  type: z.literal("approval.resolved"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("request"),
    kind: z.literal("approval.resolved"),
    payload: z.object({
      request_id: requestIdSchema,
      decision: z.enum(["approve", "deny"]),
      reason: z.string().optional(),
      resolved_at: isoDateTimeSchema,
    }),
  }),
});

export const approvalFailedFrameSchema = frameBaseSchema.extend({
  type: z.literal("approval.failed"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("request"),
    kind: z.literal("approval.failed"),
    payload: z.object({
      request_id: requestIdSchema,
      decision: z.enum(["approve", "deny"]),
      reason: z.string().optional(),
      failed_at: isoDateTimeSchema,
      code: z.enum(["APPROVAL_UNIMPLEMENTED", "NO_PENDING_REQUEST", "SDK_ERROR"]),
      message: z.string(),
    }),
  }),
});

export const serverFrameSchema = z.discriminatedUnion("type", [
  ackFrameSchema,
  errorFrameSchema,
  serverHeartbeatFrameSchema,
  systemEventFrameSchema,
  userEventFrameSchema,
  assistantEventFrameSchema,
  thinkingEventFrameSchema,
  toolCallEventFrameSchema,
  statusEventFrameSchema,
  taskEventFrameSchema,
  subagentSpawnedFrameSchema,
  subagentCompletedFrameSchema,
  requestEventFrameSchema,
  codeEditDetectedFrameSchema,
  runFinalResultFrameSchema,
  runInterruptedFrameSchema,
  approvalResolvedFrameSchema,
  approvalFailedFrameSchema,
]);
export type ServerFrame = z.infer<typeof serverFrameSchema>;
