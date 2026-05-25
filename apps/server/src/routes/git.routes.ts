import { gitStatusResponseSchema } from "@harness/shared";
import type { FastifyInstance } from "fastify";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
  resolveWorkspacePath,
  type WorkspaceResolverDeps,
} from "../lib/workspace-resolver.js";

const execFile = promisify(execFileCb);

export type GitRoutesDeps = WorkspaceResolverDeps;

/**
 * In-memory cache for git status, keyed by workspace path.
 * Entries expire after 10 seconds.
 */
const gitStatusCache = new Map<
  string,
  { data: ReturnType<typeof gitStatusResponseSchema.parse>; expiresAt: number }
>();

const CACHE_TTL_MS = 10_000;
const CACHE_MAX_ENTRIES = 10;

function cacheSet(
  key: string,
  data: ReturnType<typeof gitStatusResponseSchema.parse>,
  expiresAt: number,
): void {
  // Evict the oldest entry when the cache exceeds the max size.
  // Map preserves insertion order, so the first key is the oldest.
  if (gitStatusCache.size >= CACHE_MAX_ENTRIES && !gitStatusCache.has(key)) {
    const oldest = gitStatusCache.keys().next().value;
    if (oldest !== undefined) gitStatusCache.delete(oldest);
  }
  gitStatusCache.set(key, { data, expiresAt });
}

async function gitExec(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; ok: boolean }> {
  try {
    const { stdout } = await execFile("git", args, {
      cwd,
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    return { stdout: stdout.trim(), ok: true };
  } catch {
    return { stdout: "", ok: false };
  }
}

export async function registerGitRoutes(
  app: FastifyInstance,
  deps: GitRoutesDeps,
): Promise<void> {
  app.get("/api/git/status", async (_req, reply) => {
    const workspacePath = resolveWorkspacePath(deps);
    if (!workspacePath) {
      return reply.code(412).send({
        code: "NO_ACTIVE_WORKSPACE",
        message: "No active workspace configured.",
      });
    }

    // Check cache
    const now = Date.now();
    const cached = gitStatusCache.get(workspacePath);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    // Check if inside a git repo
    const isGitRepoResult = await gitExec(
      ["rev-parse", "--is-inside-work-tree"],
      workspacePath,
    );
    const isGitRepo = isGitRepoResult.ok && isGitRepoResult.stdout === "true";

    if (!isGitRepo) {
      const data = gitStatusResponseSchema.parse({
        isGitRepo: false,
        branch: null,
        isDirty: false,
        ahead: 0,
        behind: 0,
      });
      cacheSet(workspacePath, data, now + CACHE_TTL_MS);
      return data;
    }

    // Run all four git queries in parallel after confirming isGitRepo.
    const [branchResult, statusResult, aheadResult, behindResult] =
      await Promise.all([
        gitExec(["rev-parse", "--abbrev-ref", "HEAD"], workspacePath),
        gitExec(["status", "--porcelain"], workspacePath),
        gitExec(["rev-list", "--count", "@{upstream}..HEAD"], workspacePath),
        gitExec(["rev-list", "--count", "HEAD..@{upstream}"], workspacePath),
      ]);
    const branch = branchResult.ok ? branchResult.stdout : null;
    const isDirty = statusResult.ok && statusResult.stdout.length > 0;
    const ahead = aheadResult.ok ? parseInt(aheadResult.stdout, 10) || 0 : 0;
    const behind = behindResult.ok ? parseInt(behindResult.stdout, 10) || 0 : 0;

    const data = gitStatusResponseSchema.parse({
      isGitRepo,
      branch,
      isDirty,
      ahead,
      behind,
    });
    gitStatusCache.set(workspacePath, { data, expiresAt: now + CACHE_TTL_MS });
    return data;
  });
}
