// JSON primitives
export { jsonValueSchema, safeParse, safeStringify } from "./json.js";
export type { JsonValue } from "./json.js";

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

// WebSocket frame protocol
export {
  ackFrameSchema,
  approvalResponseFrameSchema,
  assistantEventFrameSchema,
  cancelRunFrameSchema,
  clientFrameSchema,
  clientHeartbeatFrameSchema,
  codeEditDetectedFrameSchema,
  deleteRunFrameSchema,
  errorFrameSchema,
  frameBaseSchema,
  requestEventFrameSchema,
  runFinalResultFrameSchema,
  runInterruptedFrameSchema,
  serverFrameSchema,
  serverHeartbeatFrameSchema,
  statusEventFrameSchema,
  submitUserInputFrameSchema,
  subscribeRunFrameSchema,
  systemEventFrameSchema,
  taskEventFrameSchema,
  thinkingEventFrameSchema,
  toolCallEventFrameSchema,
  unsubscribeRunFrameSchema,
  updateSettingsFrameSchema,
  userEventFrameSchema,
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
  eventEnvelopeSchema,
  getRunEventsQuerySchema,
  healthLiveResponseSchema,
  healthReadyResponseSchema,
  healthVersionResponseSchema,
  listAgentsQuerySchema,
  listAgentsResponseSchema,
  listRunsQuerySchema,
  listRunsResponseSchema,
  mcpServerSummarySchema,
  replaceMcpServerRequestSchema,
  replaceSubagentRequestSchema,
  runSummarySchema,
  setApiKeyRequestSchema,
  settingsSnapshotSchema,
  updateAgentRequestSchema,
  updateMcpServerRequestSchema,
  updatePricingRequestSchema,
  updateSettingsRequestSchema,
  updateSubagentRequestSchema,
  usageDateRangeQuerySchema,
  usageSummaryResponseSchema,
  validateWorkspacePathRequestSchema,
  validateWorkspacePathResponseSchema,
} from "./rest-contracts.js";
export type {
  AgentDetailResponse,
  AgentSummary,
  CreateAgentRequest,
  CreateMcpServerRequest,
  CreateRunRequest,
  CreateRunResponse,
  CreateSubagentRequest,
  CreateWorkspaceAllowlistRequest,
  ErrorEnvelope,
  ListAgentsQuery,
  ListRunsQuery,
  McpServerSummary,
  RunSummary,
  SettingsSnapshot,
  UpdateAgentRequest,
  UpdateMcpServerRequest,
  UpdatePricingRequest,
  UpdateSettingsRequest,
  UpdateSubagentRequest,
} from "./rest-contracts.js";

export const HARNESS_VERSION = "0.0.0" as const;
