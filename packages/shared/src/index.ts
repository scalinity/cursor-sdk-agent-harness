// JSON primitives
export { jsonValueSchema, safeParse, safeStringify } from "./json.js";
export type { JsonValue } from "./json.js";

// Shared JSON-text → schema parse helper (REVIEW-S4).
export { parseJsonWithSchema } from "./parse-json-schema.js";
export type { ParseJsonOutcome } from "./parse-json-schema.js";

// Constants & primitives
export {
  LARGE_PAYLOAD_THRESHOLD_BYTES,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  agentIdSchema,
  callIdSchema,
  eventIdSchema,
  frameIdSchema,
  isoDateTimeSchema,
  requestIdSchema,
  runIdSchema,
} from "./constants.js";
export type {
  AgentId,
  CallId,
  EventId,
  FrameId,
  IsoDateTime,
  RequestId,
  RunId,
} from "./constants.js";

// Models, modes, statuses, sources
export {
  DEFAULT_MODEL_ID,
  MODEL_LABELS,
  SDK_RUN_TERMINAL_STATUSES,
  agentModeSchema,
  agentStatusSchema,
  mcpValidationStatusSchema,
  modelIdSchema,
  knownLanguageSchema,
  replaySpeedSchema,
  sdkRunStatusSchema,
  settingSourceSchema,
  usageSourceSchema,
} from "./models.js";
export type {
  AgentMode,
  AgentStatus,
  McpValidationStatus,
  ModelId,
  KnownLanguage,
  ReplaySpeed,
  SdkRunStatus,
  SettingSource,
  UsageSource,
} from "./models.js";

// Pricing helpers
export {
  PRICING_SETTING_KEYS,
  dollarsPerMillionToMicros,
  microsToDollars,
  modelPricingSchema,
  pricingKeyForModel,
  pricingPerMillionUsdMicrosSchema,
  pricingPromoMultiplierSchema,
  pricingSettingsSchema,
  pricingValueSchemaByKey,
} from "./pricing.js";
export type { ModelPricing, PricingSettingKey, PricingSettings } from "./pricing.js";

// SDK surface
export {
  assistantSdkMessageSchema,
  cloudAgentOptionsSchema,
  mcpServerConfigSchema,
  modelSelectionSchema,
  requestSdkMessageSchema,
  sdkMessageSchema,
  statusSdkMessageSchema,
  subagentModelOverrideSchema,
  subagentModelSchema,
  systemSdkMessageSchema,
  taskSdkMessageSchema,
  textBlockSchema,
  thinkingSdkMessageSchema,
  tokenUsageSchema,
  toolCallSdkMessageSchema,
  toolUseBlockSchema,
  userSdkMessageSchema,
} from "./sdk-surface.js";
export type {
  CloudAgentOptions,
  McpServerConfig,
  ModelSelection,
  SDKMessage,
  SubagentModel,
  SubagentModelOverride,
  TextBlock,
  TokenUsage,
  ToolUseBlock,
} from "./sdk-surface.js";

// Domain (DB row projections + canonical event base)
export {
  agentRowSchema,
  canonicalEventBaseSchema,
  canonicalEventKindSchema,
  eventRowSchema,
  eventSdkTypeSchema,
  mcpServerRowSchema,
  NON_BROADCAST_EVENT_KINDS,
  runInterruptedReasonSchema,
  runRowSchema,
  settingRowSchema,
  subagentDefinitionRowSchema,
  workspaceAllowlistRowSchema,
} from "./domain.js";
export type {
  AgentRow,
  CanonicalEventBase,
  CanonicalEventKind,
  EventRow,
  EventSdkType,
  McpServerRow,
  RunInterruptedReason,
  RunRow,
  SettingRow,
  SubagentDefinitionRow,
  WorkspaceAllowlistRow,
} from "./domain.js";

// WebSocket protocol
export {
  ackFrameSchema,
  approvalFailedFrameSchema,
  approvalResolvedFrameSchema,
  approvalResponseFrameSchema,
  cancelRunFrameSchema,
  clientFrameSchema,
  clientHeartbeatFrameSchema,
  codeEditDetectedFrameSchema,
  codeEditDetectedPayloadSchema,
  codeEditOperationSchema,
  deleteRunFrameSchema,
  errorFrameSchema,
  frameBaseSchema,
  runFinalResultFrameSchema,
  runInterruptedFrameSchema,
  serverFrameSchema,
  serverHeartbeatFrameSchema,
  submitUserInputFrameSchema,
  subscribeRunFrameSchema,
  unsubscribeRunFrameSchema,
  updateSettingsFrameSchema,
  wsErrorCodeSchema,
} from "./ws-protocol.js";
export type { ClientFrame, ServerFrame, WsErrorCode } from "./ws-protocol.js";

// REST contracts
export {
  agentDetailResponseSchema,
  agentSummarySchema,
  apiKeyPresenceResponseSchema,
  createAgentRequestSchema,
  createMcpServerRequestSchema,
  createRunRequestSchema,
  createRunResponseSchema,
  createSubagentRequestSchema,
  createWorkspaceAllowlistRequestSchema,
  csrfTokenResponseSchema,
  errorEnvelopeSchema,
  canonicalTranscriptEventSchema,
  eventEnvelopeSchema,
  eventLargePayloadResponseSchema,
  eventPayloadResponseSchema,
  getRunEventsQuerySchema,
  getRunEventsResponseSchema,
  healthLiveResponseSchema,
  healthReadyResponseSchema,
  healthVersionResponseSchema,
  listAgentsQuerySchema,
  listAgentsResponseSchema,
  listRunsQuerySchema,
  listRunsResponseSchema,
  largePayloadFieldSchema,
  listMcpServersResponseSchema,
  listSubagentsResponseSchema,
  mcpServerRevealResponseSchema,
  mcpServerSummarySchema,
  replaceMcpServerRequestSchema,
  replaceSubagentRequestSchema,
  subagentSummarySchema,
  runSummarySchema,
  setApiKeyRequestSchema,
  settingsSnapshotSchema,
  updateAgentRequestSchema,
  updateMcpServerRequestSchema,
  updatePricingRequestSchema,
  updateSettingsRequestSchema,
  updateSubagentRequestSchema,
  usageBreakdownResponseSchema,
  usageDailyResponseSchema,
  usageDateRangeQuerySchema,
  usageSummaryResponseSchema,
  validateWorkspacePathRequestSchema,
  validateWorkspacePathResponseSchema,
  transcriptResponseSchema,
  pricingFreshnessSchema,
} from "./rest-contracts.js";
export type {
  AgentDetailResponse,
  AgentSummary,
  CanonicalTranscriptEvent,
  CreateAgentRequest,
  CreateMcpServerRequest,
  CreateRunRequest,
  CreateRunResponse,
  CreateSubagentRequest,
  CreateWorkspaceAllowlistRequest,
  ErrorEnvelope,
  EventLargePayloadResponse,
  EventPayloadResponse,
  GetRunEventsResponse,
  LargePayloadField,
  ListAgentsQuery,
  ListMcpServersResponse,
  ListRunsQuery,
  ListSubagentsResponse,
  McpServerRevealResponse,
  McpServerSummary,
  ReplaceSubagentRequest,
  SubagentSummary,
  PricingFreshness,
  RunSummary,
  SettingsSnapshot,
  TranscriptResponse,
  UpdateAgentRequest,
  UpdateMcpServerRequest,
  UpdatePricingRequest,
  UpdateSettingsRequest,
  UpdateSubagentRequest,
  UsageBreakdownRow,
  UsageDailyPoint,
  UsageSummary,
} from "./rest-contracts.js";

export const HARNESS_VERSION = "0.0.0" as const;
