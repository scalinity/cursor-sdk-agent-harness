import {
  fileWriteRequestSchema,
  fileWriteResponseSchema,
  listWorkspaceFilesQuerySchema,
  listWorkspaceFilesResponseSchema,
  readWorkspaceFileQuerySchema,
  readWorkspaceFileResponseSchema,
} from "@harness/shared";
import type { FastifyInstance } from "fastify";
import { constants as fsConstants } from "node:fs";
import { mkdir, open as fsOpen, unlink, realpath as fsRealpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { Buffer } from "node:buffer";
import path from "node:path";
import {
  resolveWorkspacePath,
  type WorkspaceResolverDeps,
} from "../lib/workspace-resolver.js";
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  type WorkspaceFilesErrorCode,
} from "../services/workspace-files.service.js";
import { send422 } from "./route-errors.js";

export type FilesRoutesDeps = WorkspaceResolverDeps;

// Maps a workspace-files service error to the HTTP status the client expects.
const FILE_ERROR_STATUS: Record<WorkspaceFilesErrorCode, number> = {
  ABSOLUTE_PATH_REJECTED: 400,
  PATH_TRAVERSAL_REJECTED: 403,
  WORKSPACE_NOT_FOUND: 412,
  NOT_FOUND: 404,
  NOT_A_DIRECTORY: 400,
  NOT_A_FILE: 400,
};

export async function registerFilesRoutes(
  app: FastifyInstance,
  deps: FilesRoutesDeps,
): Promise<void> {
  // Read-only directory listing for the Files surface. Lists the workspace
  // root when `path` is omitted; the service rejects traversal/symlink escapes.
  app.get("/api/files/list", async (req, reply) => {
    const parsed = listWorkspaceFilesQuerySchema.safeParse(req.query);
    if (!parsed.success) return send422(reply, parsed.error);

    const workspaceRoot = resolveWorkspacePath(deps, parsed.data.workspaceId);
    if (!workspaceRoot) {
      return reply.code(412).send({
        code: "NO_ACTIVE_WORKSPACE",
        message: "No active workspace configured.",
      });
    }

    const result = await listWorkspaceFiles(workspaceRoot, parsed.data.path);
    if (!result.ok) {
      return reply.code(FILE_ERROR_STATUS[result.code]).send({ code: result.code });
    }
    return listWorkspaceFilesResponseSchema.parse(result.value);
  });

  // Read-only file content (capped + binary-sniffed) for the preview pane.
  app.get("/api/files/read", async (req, reply) => {
    const parsed = readWorkspaceFileQuerySchema.safeParse(req.query);
    if (!parsed.success) return send422(reply, parsed.error);

    const workspaceRoot = resolveWorkspacePath(deps, parsed.data.workspaceId);
    if (!workspaceRoot) {
      return reply.code(412).send({
        code: "NO_ACTIVE_WORKSPACE",
        message: "No active workspace configured.",
      });
    }

    const result = await readWorkspaceFile(workspaceRoot, parsed.data.path);
    if (!result.ok) {
      return reply.code(FILE_ERROR_STATUS[result.code]).send({ code: result.code });
    }
    return readWorkspaceFileResponseSchema.parse(result.value);
  });

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

    // Write the file. O_NOFOLLOW rejects an existing symlink target before any
    // bytes are written; the post-write realpath check remains as a race guard.
    const buf = Buffer.from(content, "utf-8");
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    let handle: FileHandle | undefined;
    try {
      handle = await fsOpen(
        resolvedTarget,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | noFollow,
        0o666,
      );
      await handle.writeFile(buf);
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String(err.code) : null;
      if (code === "ELOOP") {
        return reply.code(403).send({
          code: "SYMLINK_TARGET_REJECTED",
          message: "Refusing to write through a symlink target.",
        });
      }
      throw err;
    } finally {
      await handle?.close().catch(() => undefined);
    }

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
