// Cursor SDK runtime barrel. Phase 06 introduced the runtime + adapter
// + active-runs registry; Phase 07 adds the normalizer + persist-then-
// broadcast pipeline, exposed here so `buildApp` can wire them through.

export {
  createAgentRuntime,
  AgentRuntimeError,
  type AgentRuntime,
  type AgentRuntimeDeps,
} from "./agent-runtime.js";
export {
  createCursorSdkAdapter,
  type SdkAdapter,
} from "./sdk-adapter.js";
export { ActiveRuns } from "./active-runs.js";
export {
  RunController,
  newRunId,
  type CancelResult,
} from "./run-controller.js";
export { createStubSink, type StreamSink } from "./stream-stub.js";
export {
  extractUsage,
  accumulateTurnEndedUsage,
  type ExtractedUsage,
  type ExtractedUsageInput,
} from "./usage-extractor.js";
export {
  buildAgentOptions,
  WorkspaceRejectedError,
  type BuildAgentOptionsInput,
} from "./agent-options-builder.js";
export {
  normalize,
  type CanonicalRunEventDraft,
  type NormalizeInput,
  type NormalizeOutput,
  type RunContext,
  type TextBufferUpdates,
} from "./normalizer.js";
export {
  createPersistAndBroadcast,
  type IngestArgs,
  type PersistAndBroadcastPipeline,
  type PipelineDeps,
  type PipelineOptions,
} from "./persist-and-broadcast.js";
