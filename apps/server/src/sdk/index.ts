// Phase 06 — Cursor SDK runtime barrel. Exports the AgentRuntime contract,
// the SDK adapter seam, and the stub stream sink. Phase 07 will add the
// normalization pipeline and replace the stub sink without touching the
// runtime layer.

export {
  createAgentRuntime,
  AgentRuntimeError,
  WorkspaceRejectedError,
  type AgentRuntime,
  type AgentRuntimeDeps,
} from "./agent-runtime.js";
export {
  createCursorSdkAdapter,
  type SdkAdapter,
} from "./sdk-adapter.js";
export { ActiveRuns } from "./active-runs.js";
export { RunController, newRunId } from "./run-controller.js";
export { createStubSink, type StreamSink } from "./stream-stub.js";
export {
  extractUsage,
  accumulateTurnEndedUsage,
  type ExtractedUsage,
  type ExtractedUsageInput,
} from "./usage-extractor.js";
export {
  buildAgentOptions,
  type BuildAgentOptionsInput,
} from "./agent-options-builder.js";
