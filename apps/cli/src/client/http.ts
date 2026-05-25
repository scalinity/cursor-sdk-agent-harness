import { randomUUID } from "node:crypto";
import path from "node:path";
import { z, type ZodTypeAny } from "zod";
import {
  agentSummarySchema,
  contextSearchResultSchema,
  createRunResponseSchema,
  csrfTokenResponseSchema,
  fileSearchResultSchema,
  grepSearchResultSchema,
  listAgentsResponseSchema,
  listRunsResponseSchema,
  type AgentSummary,
  type CreateRunRequest,
  type CreateRunResponse,
} from "@harness/shared";
import { DEFAULT_MODEL_ID } from "../config.js";
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
  fetchImpl?: typeof fetch;
}

export class HarnessHttpClient implements CliHttpPort {
  private csrfToken: string | null = null;
  private readonly fetchImpl: typeof fetch;
  readonly serverUrl: string;

  constructor(options: HarnessHttpClientOptions) {
    this.serverUrl = options.serverUrl.replace(/\/$/, "");
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

  async createAgent(input: unknown): Promise<AgentSummary> {
    return this.request("/api/agents", { method: "POST", body: input, schema: agentSummarySchema });
  }

  async getOrCreateAgent(input: {
    agentId?: string;
    name?: string;
    model?: string;
    mode?: CliMode;
    workspace?: string;
  }): Promise<CliAgentSummary> {
    if (input.agentId) {
      const detail = await this.request("/api/agents/" + encodeURIComponent(input.agentId), { schema: agentSummarySchema.passthrough() });
      return {
        id: String(detail.id),
        name: String(detail.name),
        modelId: String(detail.modelId),
        executionMode: normalizeExecutionMode(detail.executionMode),
      };
    }

    const agents = await this.listAgents({ limit: 100 });
    const active = agents.items.find((agent) => agent.status === "active" && (!input.model || agent.modelId === input.model));
    if (active) {
      return {
        id: active.id,
        name: active.name,
        modelId: active.modelId,
        executionMode: normalizeExecutionMode(active.executionMode),
      };
    }

    const workspace = input.workspace ?? process.cwd();
    const created = await this.createAgent({
      name: input.name ?? `${path.basename(workspace)} CLI`,
      modelId: input.model ?? DEFAULT_MODEL_ID,
      mode: "local",
      cwd: [workspace],
    });
    return {
      id: created.id,
      name: created.name,
      modelId: created.modelId,
      executionMode: normalizeExecutionMode(created.executionMode),
    };
  }

  async createRun(input: CreateRunRequest): Promise<CreateRunResponse> {
    return this.request("/api/runs", { method: "POST", body: input, schema: createRunResponseSchema });
  }

  async listRuns(input: Record<string, string | number | boolean | undefined>): Promise<{ items: unknown[]; total: number }> {
    return this.request("/api/runs", { query: input, schema: listRunsResponseSchema });
  }

  async grepSearch(input: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("/api/search/grep", { query: input, schema: grepSearchResultSchema });
  }

  async fileSearch(input: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("/api/search/files", { query: input, schema: fileSearchResultSchema });
  }

  async contextSearch(query: string): Promise<unknown> {
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
    if (MUTATING_METHODS.has(method)) headers["X-CSRF-Token"] = await this.ensureCsrfToken();

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

function normalizeExecutionMode(value: unknown): CliMode {
  return value === "ask" ? "ask" : "agent";
}
