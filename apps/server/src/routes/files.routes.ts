import {
  fileWriteRequestSchema,
  fileWriteResponseSchema,
} from "@harness/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { z } from "zod";
import { mkdir, writeFile, unlink, realpath as fsRealpath } from "node:fs/promises";
import { Buffer } from "node:buffer";
import path from "node:path";
import {
  resolveWorkspacePath,
  type WorkspaceResolverDeps,
} from "../lib/workspace-resolver.js";

export type FilesRoutesDeps = WorkspaceResolverDeps;

function send422(reply: FastifyReply, error: z.ZodError) {
  return reply.code(422).send({
    code: "VALIDATION_ERROR",
    details: error.issues,
  });
}

export async function registerFilesRoutes(
  app: FastifyInstance,
  deps: FilesRoutesDeps,
): Promise<void> {
  app.post("/api/files/write", async (req, reply) => {
    const parsed = fileWriteRequestSchema.safeParse(req.body);
    if (!parsed.success) return send422(reply, parsed.error);

    const { path: relativePath, content, workspaceId } = parsed.data;

    const workspaceRoot = resolveWorkspacePath(deps, workspaceId);
    if (!workspaceRoot) {
      return reply.code(412).send({
        code: "NO_ACTIVE_WORKSPACE",
        message: "No active workspace configured.",
      });
    }

    // Reject absolute paths in the request
    if (path.isAbsolute(relativePath)) {
      return reply.code(400).send({
        code: "ABSOLUTE_PATH_REJECTED",
        message: "Path must be relative to the workspace root.",
      });
    }

    // Resolve and verify the target path stays within workspace
    const resolvedTarget = path.resolve(workspaceRoot, relativePath);

    // Ensure the resolved path is within the workspace root (prevent traversal)
    let realWorkspaceRoot: string;
    try {
      realWorkspaceRoot = await fsRealpath(workspaceRoot);
    } catch {
      return reply.code(412).send({
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace root directory does not exist.",
      });
    }

    // For the target, we check the resolved path before creation.
    // The parent dir may not exist yet (we create it), so we check the
    // normalized path string first, then verify with realpath after mkdir.
    const normalizedTarget = path.normalize(resolvedTarget);
    const normalizedRoot = path.normalize(realWorkspaceRoot);
    if (
      !normalizedTarget.startsWith(normalizedRoot + path.sep) &&
      normalizedTarget !== normalizedRoot
    ) {
      return reply.code(403).send({
        code: "PATH_TRAVERSAL_REJECTED",
        message: "Resolved path escapes the workspace root.",
      });
    }

    // Create parent directories
    const parentDir = path.dirname(resolvedTarget);
    await mkdir(parentDir, { recursive: true });

    // After mkdir, verify with realpath that the parent is still inside workspace
    try {
      const realParent = await fsRealpath(parentDir);
      if (
        !realParent.startsWith(realWorkspaceRoot + path.sep) &&
        realParent !== realWorkspaceRoot
      ) {
        return reply.code(403).send({
          code: "PATH_TRAVERSAL_REJECTED",
          message: "Resolved parent directory escapes the workspace root.",
        });
      }
    } catch {
      return reply.code(500).send({
        code: "PARENT_DIR_ERROR",
        message: "Failed to verify parent directory.",
      });
    }

    // Write the file
    const buf = Buffer.from(content, "utf-8");
    await writeFile(resolvedTarget, buf);

    // Post-write TOCTOU check: verify the written file is still inside the
    // workspace root. A race between path check and write could place the
    // file outside the root if a symlink was swapped in concurrently.
    try {
      const realWritten = await fsRealpath(resolvedTarget);
      if (
        !realWritten.startsWith(realWorkspaceRoot + path.sep) &&
        realWritten !== realWorkspaceRoot
      ) {
        // The file escaped the workspace — remove it and deny.
        await unlink(resolvedTarget).catch(() => {/* best-effort cleanup */});
        return reply.code(403).send({
          code: "PATH_TRAVERSAL_REJECTED",
          message: "Written file escaped the workspace root.",
        });
      }
    } catch {
      // If realpath fails after write, the file may be dangling. Clean up.
      await unlink(resolvedTarget).catch(() => {/* best-effort cleanup */});
      return reply.code(500).send({
        code: "POST_WRITE_VERIFY_FAILED",
        message: "Failed to verify written file path.",
      });
    }

    return fileWriteResponseSchema.parse({
      absolutePath: resolvedTarget,
      bytesWritten: buf.byteLength,
    });
  });
}
