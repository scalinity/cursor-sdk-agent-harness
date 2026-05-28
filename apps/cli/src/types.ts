import type {
  AgentDetailResponse,
  AgentSummary,
  ContextMention,
  ContextSearchResult,
  CreateAgentRequest,
  CreateRunRequest,
  CreateRunResponse,
  FileSearchResult,
  GetRunEventsResponse,
  GrepSearchResult,
  RunSummary,
  ServerFrame,
  UpdateAgentRequest,
} from "@harness/shared";

export type CliMode = "ask" | "agent";

export interface CliAgentSummary {
  id: string;
  name: string;
  modelId: string;
  executionMode: CliMode;
}

export interface CliHttpPort {
  ensureCsrfToken(): Promise<string>;
  getAgent(agentId: string): Promise<AgentDetailResponse>;
  getOrCreateAgent(input: {
    agentId?: string;
    name?: string;
    model?: string;
    mode?: CliMode;
    workspace?: string;
  }): Promise<CliAgentSummary>;
  createRun(input: CreateRunRequest): Promise<CreateRunResponse>;
  getRun(runId: string): Promise<RunSummary>;
  getRunEvents(runId: string, input?: { afterSeq?: number; limit?: number; direction?: "asc" | "desc" }): Promise<GetRunEventsResponse>;
  listAgents(input?: { limit?: number; offset?: number }): Promise<{ items: AgentSummary[] }>;
  createAgent(input: CreateAgentRequest): Promise<AgentSummary>;
  updateAgent(agentId: string, input: UpdateAgentRequest): Promise<AgentDetailResponse>;
  listRuns(input: Record<string, string | number | boolean | undefined>): Promise<{ items: RunSummary[]; total: number }>;
  grepSearch(input: Record<string, string | number | boolean | undefined>): Promise<GrepSearchResult>;
  fileSearch(input: Record<string, string | number | boolean | undefined>): Promise<FileSearchResult>;
  contextSearch(query: string): Promise<ContextSearchResult>;
}

export interface CliStreamPort {
  subscribeToRun(runId: string, onFrame: (frame: ServerFrame) => void): Promise<void>;
  cancelRun?(runId: string): boolean;
  sendApproval?(runId: string, requestId: string, decision: "approve" | "deny", reason?: string): void;
  close?(): void;
  /** Called after consecutive inbound frame validation failures cross the threshold. */
  setFrameValidationDegradedHandler?(handler: ((message: string) => void) | null): void;
}

export interface CommandDeps {
  http: CliHttpPort;
  stream?: CliStreamPort;
  write: (line: string) => void;
  writeRaw?: (text: string) => void;
  writeError?: (line: string) => void;
}

export interface MentionSelectionItem {
  kind: ContextMention["kind"];
  value: string;
  label: string;
  detail?: string;
}
