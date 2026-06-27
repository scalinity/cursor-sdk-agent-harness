import { randomUUID } from "node:crypto";
import path from "node:path";
import { z, type ZodTypeAny } from "zod";
import {
  agentDetailResponseSchema,
  agentSummarySchema,
  contextSearchResultSchema,
  createAgentRequestSchema,
  createRunResponseSchema,
  csrfTokenResponseSchema,
  fileSearchResultSchema,
  getRunEventsResponseSchema,
  grepSearchResultSchema,
  runSummarySchema,
  listAgentsResponseSchema,
  listModelsResponseSchema,
  listRunsResponseSchema,
  updateAgentRequestSchema,
  type AgentDetailResponse,
  type ListModelsResponse,
  type AgentSummary,
  type ContextSearchResult,
  type CreateAgentRequest,
  type CreateRunRequest,
  type CreateRunResponse,
  type FileSearchResult,
  type GetRunEventsResponse,
  type GrepSearchResult,
  type RunSummary,
  type UpdateAgentRequest,
} from "@harness/shared";
import { DEFAULT_MODEL_ID, DEFAULT_WEB_ORIGIN } from "../config.js";
import { toCliAgentSummary } from "../lib/cli-agent.js";
import type { CliAgentSummary, CliHttpPort, CliMode } from "../types.js";

export class CliHttpError<TBody = unknown> extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: TBody | null;

  constructor(message: string, status: number, code: string | null, body: TBody | null) {
    super(message);
    this.name = "CliHttpError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const workspaceListSchema = z.object({
  items: z.array(z.object({ id: z.string(), path: z.string(), label: z.string().nullable().optional(), recursive: z.boolean() })),
});

export interface HarnessHttpClientOptions {
  serverUrl: string;
  origin?: string;
  fetchImpl?: typeof fetch;
}

export class HarnessHttpClient implements CliHttpPort {
  private csrfToken: string | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly origin: string;
  readonly serverUrl: string;

  constructor(options: HarnessHttpClientOptions) {
    this.serverUrl = options.serverUrl.replace(/\/$/, "");
    this.origin = (options.origin ?? DEFAULT_WEB_ORIGIN).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async ensureCsrfToken(): Promise<string> {
    if (this.csrfToken) return this.csrfToken;
    const response = await this.request("/api/security/csrf-token", { schema: csrfTokenResponseSchema });
    this.csrfToken = response.token;
    return response.token;
  }

  async listAgents(input: { limit?: number; offset?: number } = {}): Promise<{ items: AgentSummary[] }> {
    return this.request("/api/agents", { query: input, schema: listAgentsResponseSchema });
  }

  async listModels(): Promise<ListModelsResponse> {
    return this.request("/api/models", { schema: listModelsResponseSchema });
  }

  async getAgent(agentId: string): Promise<AgentDetailResponse> {
    return this.request("/api/agents/" + encodeURIComponent(agentId), { schema: agentDetailResponseSchema });
  }

  async createAgent(input: CreateAgentRequest): Promise<AgentSummary> {
    const parsed = createAgentRequestSchema.parse(input);
    return this.request("/api/agents", { method: "POST", body: parsed, schema: agentSummarySchema });
  }

  async updateAgent(agentId: string, input: UpdateAgentRequest): Promise<AgentDetailResponse> {
    const parsed = updateAgentRequestSchema.parse(input);
    return this.request("/api/agents/" + encodeURIComponent(agentId), { method: "PATCH", body: parsed, schema: agentDetailResponseSchema });
  }

  async getOrCreateAgent(input: {
    agentId?: string;
    name?: string;
    model?: string;
    mode?: CliMode;
    workspace?: string;
  }): Promise<CliAgentSummary> {
    if (input.agentId) {
      const detail = await this.getAgent(input.agentId);
      return toCliAgentSummary(detail);
    }

    const workspace = path.resolve(input.workspace ?? process.cwd());
    const agents = await this.listAgents({ limit: 100 });
    for (const agent of agents.items) {
      if (agent.status !== "active") continue;
      if (input.model && agent.modelId !== input.model) continue;
      const detail = await this.getAgent(agent.id);
      if (!agentHasWorkspace(detail, workspace)) continue;
      if (input.mode && detail.executionMode !== input.mode) {
        return toCliAgentSummary(await this.updateAgent(detail.id, { executionMode: input.mode }));
      }
      return toCliAgentSummary(detail);
    }

    const created = await this.createAgent({
      name: input.name ?? `${path.basename(workspace)} CLI`,
      modelId: input.model ?? DEFAULT_MODEL_ID,
      mode: "local",
      cwd: [workspace],
      mcpServerIds: [],
      subagentDefinitionIds: [],
    });
    if (input.mode && created.executionMode !== input.mode) {
      return toCliAgentSummary(await this.updateAgent(created.id, { executionMode: input.mode }));
    }
    return toCliAgentSummary(created);
  }

  async createRun(input: CreateRunRequest): Promise<CreateRunResponse> {
    return this.request("/api/runs", { method: "POST", body: input, schema: createRunResponseSchema });
  }

  async getRun(runId: string): Promise<RunSummary> {
    return this.request("/api/runs/" + encodeURIComponent(runId), { schema: runSummarySchema });
  }

  async getRunEvents(
    runId: string,
    input: { afterSeq?: number; limit?: number; direction?: "asc" | "desc" } = {},
  ): Promise<GetRunEventsResponse> {
    return this.request("/api/runs/" + encodeURIComponent(runId) + "/events", {
      query: {
        after_seq: input.afterSeq,
        limit: input.limit,
        direction: input.direction,
      },
      schema: getRunEventsResponseSchema,
    });
  }

  async listRuns(input: Record<string, string | number | boolean | undefined>): Promise<{ items: RunSummary[]; total: number }> {
    return this.request("/api/runs", { query: input, schema: listRunsResponseSchema });
  }

  async grepSearch(input: Record<string, string | number | boolean | undefined>): Promise<GrepSearchResult> {
    return this.request("/api/search/grep", { query: input, schema: grepSearchResultSchema });
  }

  async fileSearch(input: Record<string, string | number | boolean | undefined>): Promise<FileSearchResult> {
    return this.request("/api/search/files", { query: input, schema: fileSearchResultSchema });
  }

  async contextSearch(query: string): Promise<ContextSearchResult> {
    return this.request("/api/context/search", { query: { q: query }, schema: contextSearchResultSchema });
  }

  async listWorkspaces(): Promise<z.infer<typeof workspaceListSchema>> {
    return this.request("/api/workspace-allowlist", { schema: workspaceListSchema });
  }

  async addWorkspace(workspacePath: string): Promise<unknown> {
    return this.request("/api/workspace-allowlist", {
      method: "POST",
      body: { path: workspacePath, recursive: true },
      schema: z.unknown(),
    });
  }

  private async request<TSchema extends ZodTypeAny>(
    route: string,
    options: {
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      query?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      schema: TSchema;
    },
  ): Promise<z.infer<TSchema>> {
    const method = options.method ?? "GET";
    const url = new URL(route, this.serverUrl);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Request-Id": randomUUID(),
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (MUTATING_METHODS.has(method)) {
      headers["Origin"] = this.origin;
      headers["X-CSRF-Token"] = await this.ensureCsrfToken();
    }

    let response: Response;
    try {
      const init: RequestInit = { method, headers };
      if (options.body !== undefined) init.body = JSON.stringify(options.body);
      response = await this.fetchImpl(url, init);
    } catch (error) {
      throw new CliHttpError(error instanceof Error ? error.message : "network error", 0, "NETWORK_ERROR", null);
    }

    const text = await response.text();
    let parsedBody: unknown = null;
    if (text.length > 0) {
      try {
        parsedBody = JSON.parse(text);
      } catch {
        parsedBody = text;
      }
    }
    if (!response.ok) {
      const envelope = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody as Record<string, unknown> : {};
      throw new CliHttpError(
        typeof envelope.message === "string" ? envelope.message : `${method} ${route} failed (${response.status})`,
        response.status,
        typeof envelope.code === "string" ? envelope.code : null,
        parsedBody,
      );
    }
    const parsed = options.schema.safeParse(parsedBody);
    if (!parsed.success) {
      throw new CliHttpError(`Response schema validation failed for ${route}`, response.status, "SCHEMA_VALIDATION_FAILED", parsed.error.flatten());
    }
    return parsed.data;
  }
}

function agentHasWorkspace(agent: AgentDetailResponse, workspace: string): boolean {
  const cwd = agent.cwd ?? [];
  return cwd.some((entry) => path.resolve(entry) === workspace);
}
