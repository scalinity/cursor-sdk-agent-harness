import {
  activeWorkspaceResponseSchema,
  createWorkspaceAllowlistRequestSchema,
  setActiveWorkspaceRequestSchema,
  validateWorkspacePathRequestSchema,
  workspaceAllowlistRowSchema,
} from "@harness/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { SettingsRepo } from "../db/repositories/settings.repo.js";
import type { WorkspaceAllowlistRepo } from "../db/repositories/workspace-allowlist.repo.js";
import type { WorkspacePolicy } from "../security/workspace-policy.js";
import { ACTIVE_WORKSPACE_SETTING_KEY } from "../config/settings-keys.js";
export { ACTIVE_WORKSPACE_SETTING_KEY };

export interface WorkspaceAllowlistRoutesDeps {
  allowlist: WorkspaceAllowlistRepo;
  policy: WorkspacePolicy;
  settings: SettingsRepo;
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

function readActiveWorkspaceId(settings: SettingsRepo): string | null {
  const raw = settings.get<string | null>(ACTIVE_WORKSPACE_SETTING_KEY);
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export async function registerWorkspaceAllowlistRoutes(
  app: FastifyInstance,
  deps: WorkspaceAllowlistRoutesDeps,
): Promise<void> {
  app.get("/api/workspace-allowlist", async () => ({
    items: deps.allowlist.list().map((r) => workspaceAllowlistRowSchema.parse(r)),
  }));

  // Phase 16 — active workspace endpoints. Placed BEFORE the dynamic
  // `/:entryId` route so Fastify's matcher doesn't mistake `/active`
  // for an entry id.
  app.get("/api/workspace-allowlist/active", async () => {
    const id = readActiveWorkspaceId(deps.settings);
    if (!id) {
      return activeWorkspaceResponseSchema.parse({
        activeWorkspaceId: null,
        workspace: null,
      });
    }
    const entry = deps.allowlist.getById(id);
    if (!entry) {
      // Stale id (e.g. the allowlist row was deleted). Clear it and
      // surface null so the renderer prompts the user to pick again.
      deps.settings.set(ACTIVE_WORKSPACE_SETTING_KEY, null);
      return activeWorkspaceResponseSchema.parse({
        activeWorkspaceId: null,
        workspace: null,
      });
    }
    return activeWorkspaceResponseSchema.parse({
      activeWorkspaceId: id,
      workspace: workspaceAllowlistRowSchema.parse(entry),
    });
  });

  app.put("/api/workspace-allowlist/active", async (req, reply) => {
    const parsed = setActiveWorkspaceRequestSchema.safeParse(req.body);
    if (!parsed.success) return send422(reply, parsed.error);
    if (parsed.data.id === null) {
      deps.settings.set(ACTIVE_WORKSPACE_SETTING_KEY, null);
      return activeWorkspaceResponseSchema.parse({
        activeWorkspaceId: null,
        workspace: null,
      });
    }
    const entry = deps.allowlist.getById(parsed.data.id);
    if (!entry) {
      return reply.code(404).send({ code: "NOT_FOUND" });
    }
    deps.settings.set(ACTIVE_WORKSPACE_SETTING_KEY, parsed.data.id);
    deps.allowlist.markUsed(parsed.data.id);
    return activeWorkspaceResponseSchema.parse({
      activeWorkspaceId: parsed.data.id,
      workspace: workspaceAllowlistRowSchema.parse(entry),
    });
  });

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
    // Idempotent: if a row already exists with this exact path, return it
    // with 200 instead of trying to INSERT (which would fail the UNIQUE
    // constraint on workspace_allowlist.path). The picker can hit this
    // route for a path its local `entries` snapshot doesn't yet contain —
    // its useState cache is captured in a closure across the native folder
    // dialog's await, so it races with the allowlist reload. We compare
    // paths exactly so a recursive ancestor row doesn't shadow a
    // legitimate new child path.
    const existing = deps.allowlist.findMatching(realpathToStore);
    if (existing && existing.path === realpathToStore) {
      return reply.code(200).send(workspaceAllowlistRowSchema.parse(existing));
    }
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
      // R17-W2: clear the active-workspace pointer FIRST (safe ordering — if
      // anything throws mid-delete the pointer is already null, never
      // dangling). runs.workspace_id has no FK, so a stale pointer would
      // otherwise reference a deleted row and could suppress the
      // workspace-required modal in the shell.
      if (deps.settings.get<string | null>(ACTIVE_WORKSPACE_SETTING_KEY) === req.params.entryId) {
        deps.settings.set(ACTIVE_WORKSPACE_SETTING_KEY, null);
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
