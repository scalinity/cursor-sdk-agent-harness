import {
  createMcpServerRequestSchema,
  listMcpServersResponseSchema,
  mcpServerRevealResponseSchema,
  mcpServerSummarySchema,
  updateMcpServerRequestSchema,
  type McpServerRow,
  type McpServerSummary,
} from "@harness/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { z } from "zod";
import type { McpServersRepo } from "../db/repositories/mcp-servers.repo.js";
import {
  redactMcpConfig,
  validateMcpServerConfig,
  type McpValidationResult,
  type McpValidatorOptions,
} from "../mcp/mcp-validator.js";

export interface McpServersRoutesDeps {
  mcpServers: McpServersRepo;
  /**
   * Optional probe timeout — tests inject a low value so the integration
   * suite doesn't pay 3s per probe. Defaults to env `MCP_PROBE_TIMEOUT_MS`,
   * else 3000.
   */
  probeTimeoutMs?: number;
  /**
   * Test seam: inject a deterministic validator (skip network/spawn).
   * Production passes nothing and the route calls the real validator.
   */
  validatorOverride?: (
    config: unknown,
    options: McpValidatorOptions,
  ) => Promise<McpValidationResult>;
}

function send422(reply: FastifyReply, error: z.ZodError) {
  return reply.code(422).send({
    code: "VALIDATION_ERROR",
    details: error.issues,
  });
}

function transportFromRow(row: McpServerRow): "stdio" | "http" | "sse" {
  if ("command" in row.config) return "stdio";
  return row.config.type === "sse" ? "sse" : "http";
}

function toSummary(row: McpServerRow): McpServerSummary {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    validationStatus: row.validationStatus,
    validationMessage: row.validationMessage,
    lastStatus: row.lastStatus,
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    configRedacted: redactMcpConfig(row.config),
    transport: transportFromRow(row),
  };
}

interface ProbeOutcome {
  status: McpServerRow["validationStatus"];
  message: string | null;
  lastStatus: string | null;
}

function probeOutcomeFromResult(result: McpValidationResult): ProbeOutcome {
  switch (result.status) {
    case "valid":
      return {
        status: "valid",
        message: result.details ?? null,
        lastStatus: result.details ?? "ok",
      };
    case "invalid":
      return {
        status: "invalid",
        message: result.reason,
        lastStatus: result.reason,
      };
    case "unreachable":
      return {
        status: "unreachable",
        message: result.reason,
        lastStatus: result.reason,
      };
  }
}

export async function registerMcpServersRoutes(
  app: FastifyInstance,
  deps: McpServersRoutesDeps,
): Promise<void> {
  const probeTimeoutMs =
    deps.probeTimeoutMs ??
    (process.env.MCP_PROBE_TIMEOUT_MS
      ? Number.parseInt(process.env.MCP_PROBE_TIMEOUT_MS, 10)
      : undefined);
  const validate = deps.validatorOverride ?? validateMcpServerConfig;
  const probeOptions: McpValidatorOptions = {
    ...(probeTimeoutMs !== undefined && Number.isFinite(probeTimeoutMs)
      ? { timeoutMs: probeTimeoutMs }
      : {}),
  };

  app.get("/api/mcp-servers", async () => {
    const items = deps.mcpServers.list().map(toSummary);
    return listMcpServersResponseSchema.parse({ items });
  });

  app.post("/api/mcp-servers", async (req, reply) => {
    const parsed = createMcpServerRequestSchema.safeParse(req.body);
    if (!parsed.success) return send422(reply, parsed.error);
    if (deps.mcpServers.getByName(parsed.data.name)) {
      return reply.code(409).send({
        code: "NAME_CONFLICT",
        message: `An MCP server named "${parsed.data.name}" already exists.`,
      });
    }
    const row = deps.mcpServers.create({
      name: parsed.data.name,
      enabled: parsed.data.enabled,
      config: parsed.data.config,
    });
    const probe = await validate(parsed.data.config, probeOptions);
    const outcome = probeOutcomeFromResult(probe);
    const updated = deps.mcpServers.update(row.id, {
      validationStatus: outcome.status,
      validationMessage: outcome.message,
      lastStatus: outcome.lastStatus,
      lastCheckedAt: new Date().toISOString(),
    });
    return reply.code(201).send(mcpServerSummarySchema.parse(toSummary(updated)));
  });

  app.put<{ Params: { id: string } }>(
    "/api/mcp-servers/:id",
    async (req, reply) => {
      // Replace = full create-request body but the route distinguishes
      // config-change (re-probe) vs metadata-only (skip probe).
      const parsed = createMcpServerRequestSchema.safeParse(req.body);
      if (!parsed.success) return send422(reply, parsed.error);
      const existing = deps.mcpServers.getById(req.params.id);
      if (!existing) return reply.code(404).send({ code: "NOT_FOUND" });
      if (
        parsed.data.name !== existing.name &&
        deps.mcpServers.getByName(parsed.data.name)
      ) {
        return reply.code(409).send({
          code: "NAME_CONFLICT",
          message: `An MCP server named "${parsed.data.name}" already exists.`,
        });
      }
      const configChanged =
        JSON.stringify(parsed.data.config) !== JSON.stringify(existing.config);
      const baseUpdate = {
        name: parsed.data.name,
        enabled: parsed.data.enabled,
        config: parsed.data.config,
      };
      if (!configChanged) {
        const row = deps.mcpServers.update(req.params.id, baseUpdate);
        return mcpServerSummarySchema.parse(toSummary(row));
      }
      // Config changed → re-probe and persist the verdict atomically.
      // Reset status to `unknown` first so a slow probe isn't masked by a
      // stale `valid` row in the meantime.
      deps.mcpServers.update(req.params.id, {
        ...baseUpdate,
        validationStatus: "unknown",
        validationMessage: null,
      });
      const probe = await validate(parsed.data.config, probeOptions);
      const outcome = probeOutcomeFromResult(probe);
      const row = deps.mcpServers.update(req.params.id, {
        validationStatus: outcome.status,
        validationMessage: outcome.message,
        lastStatus: outcome.lastStatus,
        lastCheckedAt: new Date().toISOString(),
      });
      return mcpServerSummarySchema.parse(toSummary(row));
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/mcp-servers/:id",
    async (req, reply) => {
      const parsed = updateMcpServerRequestSchema.safeParse(req.body);
      if (!parsed.success) return send422(reply, parsed.error);
      const existing = deps.mcpServers.getById(req.params.id);
      if (!existing) return reply.code(404).send({ code: "NOT_FOUND" });
      if (
        parsed.data.name &&
        parsed.data.name !== existing.name &&
        deps.mcpServers.getByName(parsed.data.name)
      ) {
        return reply.code(409).send({ code: "NAME_CONFLICT" });
      }
      const updateInput: Parameters<typeof deps.mcpServers.update>[1] = {};
      if (parsed.data.name !== undefined) updateInput.name = parsed.data.name;
      if (parsed.data.enabled !== undefined) updateInput.enabled = parsed.data.enabled;
      const row = deps.mcpServers.update(req.params.id, updateInput);
      return mcpServerSummarySchema.parse(toSummary(row));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/mcp-servers/:id",
    async (req, reply) => {
      const existing = deps.mcpServers.getById(req.params.id);
      if (!existing) return reply.code(404).send({ code: "NOT_FOUND" });
      deps.mcpServers.delete(req.params.id);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/mcp-servers/:id/revalidate",
    async (req, reply) => {
      const existing = deps.mcpServers.getById(req.params.id);
      if (!existing) return reply.code(404).send({ code: "NOT_FOUND" });
      // Reset to unknown while the probe runs — surfaced as "checking..." in
      // the UI. Even though the probe completes within this request, the
      // explicit reset matches the create/replace path and means a hung
      // probe leaves a coherent record (rather than a stale valid/invalid).
      deps.mcpServers.update(req.params.id, {
        validationStatus: "unknown",
        validationMessage: null,
      });
      const probe = await validate(existing.config, probeOptions);
      const outcome = probeOutcomeFromResult(probe);
      const row = deps.mcpServers.update(req.params.id, {
        validationStatus: outcome.status,
        validationMessage: outcome.message,
        lastStatus: outcome.lastStatus,
        lastCheckedAt: new Date().toISOString(),
      });
      return mcpServerSummarySchema.parse(toSummary(row));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/mcp-servers/:id/reveal",
    async (req, reply) => {
      // Editor-only escape hatch: returns the unredacted config so the
      // editor dialog can populate token-bearing fields when the user
      // clicks "Reveal". CSRF + Origin already protect the route; the
      // surface is intentionally read-only and per-server.
      const row = deps.mcpServers.getById(req.params.id);
      if (!row) return reply.code(404).send({ code: "NOT_FOUND" });
      return mcpServerRevealResponseSchema.parse({
        id: row.id,
        name: row.name,
        config: row.config,
      });
    },
  );
}
