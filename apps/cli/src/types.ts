import type { AgentSummary, ContextMention, CreateRunRequest, CreateRunResponse, ServerFrame } from "@harness/shared";

export type CliMode = "ask" | "agent";

export interface CliAgentSummary {
  id: string;
  name: string;
  modelId: string;
  executionMode: CliMode;
}

export interface CliHttpPort {
  ensureCsrfToken(): Promise<string>;
  getOrCreateAgent(input: {
    agentId?: string;
    name?: string;
    model?: string;
    mode?: CliMode;
    workspace?: string;
  }): Promise<CliAgentSummary>;
  createRun(input: CreateRunRequest): Promise<CreateRunResponse>;
  listAgents(input?: { limit?: number; offset?: number }): Promise<{ items: AgentSummary[] }>;
  createAgent(input: unknown): Promise<AgentSummary>;
  listRuns(input: Record<string, string | number | boolean | undefined>): Promise<{ items: unknown[]; total: number }>;
  grepSearch(input: Record<string, string | number | boolean | undefined>): Promise<unknown>;
  fileSearch(input: Record<string, string | number | boolean | undefined>): Promise<unknown>;
  contextSearch(query: string): Promise<unknown>;
}

export interface CliStreamPort {
  subscribeToRun(runId: string, onFrame: (frame: ServerFrame) => void): Promise<void>;
  cancelRun?(runId: string): void;
  sendApproval?(runId: string, requestId: string, decision: "approve" | "deny", reason?: string): void;
}

export interface CommandDeps {
  http: CliHttpPort;
  stream?: CliStreamPort;
  write: (line: string) => void;
  writeError?: (line: string) => void;
}

export interface MentionSelectionItem {
  kind: ContextMention["kind"];
  value: string;
  label: string;
  detail?: string;
}
