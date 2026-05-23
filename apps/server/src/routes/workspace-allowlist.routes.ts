import {
  createWorkspaceAllowlistRequestSchema,
  validateWorkspacePathRequestSchema,
  workspaceAllowlistRowSchema,
} from "@harness/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { WorkspaceAllowlistRepo } from "../db/repositories/workspace-allowlist.repo.js";
import type { WorkspacePolicy } from "../security/workspace-policy.js";

export interface WorkspaceAllowlistRoutesDeps {
  allowlist: WorkspaceAllowlistRepo;
  policy: WorkspacePolicy;
}

const deleteQuerySchema = z.object({
  confirm: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional(),
});

const validateBatchSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(64),
});

function send422(reply: FastifyReply, error: z.ZodError) {
  return reply.code(422).send({
    code: "VALIDATION_ERROR",
    details: error.issues,
  });
}

export async function registerWorkspaceAllowlistRoutes(
  app: FastifyInstance,
  deps: WorkspaceAllowlistRoutesDeps,
): Promise<void> {
  app.get("/api/workspace-allowlist", async () => ({
    items: deps.allowlist.list().map((r) => workspaceAllowlistRowSchema.parse(r)),
  }));

  app.post("/api/workspace-allowlist", async (req, reply) => {
    const parsed = createWorkspaceAllowlistRequestSchema.safeParse(req.body);
    if (!parsed.success) return send422(reply, parsed.error);
    const decision = await deps.policy.check(parsed.data.path);
    if (decision.allowed === false && decision.reason === "missing") {
      return reply.code(422).send({
        code: "PATH_MISSING",
        normalizedPath: decision.normalizedPath,
      });
    }
    if (decision.allowed === false && decision.reason === "symlink_escape") {
      return reply.code(422).send({
        code: "SYMLINK_ESCAPE",
        normalizedPath: decision.normalizedPath,
      });
    }
    // not_allowlisted is the expected branch when adding a new entry — we still
    // resolved a realpath, so use that as the canonical path.
    const realpathToStore = decision.normalizedPath;
    const row = deps.allowlist.create({
      path: realpathToStore,
      label: parsed.data.label ?? null,
      recursive: parsed.data.recursive ?? true,
    });
    return reply.code(201).send(workspaceAllowlistRowSchema.parse(row));
  });

  app.delete<{ Params: { entryId: string }; Querystring: { confirm?: string } }>(
    "/api/workspace-allowlist/:entryId",
    async (req, reply) => {
      const queryParsed = deleteQuerySchema.safeParse(req.query);
      if (!queryParsed.success) return send422(reply, queryParsed.error);
      const entry = deps.allowlist.getById(req.params.entryId);
      if (!entry) {
        return reply.code(404).send({ code: "NOT_FOUND" });
      }
      const confirm =
        queryParsed.data.confirm === true ||
        queryParsed.data.confirm === "true";
      if (!confirm) {
        // Active-agent warning is a Phase 06+ check; for now we always require
        // an explicit `?confirm=true` to delete.
        return reply.code(409).send({
          code: "CONFIRM_REQUIRED",
          message:
            "Re-issue the request with ?confirm=true to remove this allowlist entry.",
          entry,
        });
      }
      deps.allowlist.delete(req.params.entryId);
      return reply.code(204).send();
    },
  );

  app.post("/api/workspace-allowlist/validate", async (req, reply) => {
    // Phase prompt allows both single-path and batch shapes. Prefer batch.
    const batch = validateBatchSchema.safeParse(req.body);
    if (batch.success) {
      const results = await Promise.all(
        batch.data.paths.map(async (p) => {
          const d = await deps.policy.check(p);
          return { input: p, decision: d };
        }),
      );
      return { results };
    }
    const single = validateWorkspacePathRequestSchema.safeParse(req.body);
    if (!single.success) return send422(reply, single.error);
    const decision = await deps.policy.check(single.data.path);
    return decision;
  });
}
