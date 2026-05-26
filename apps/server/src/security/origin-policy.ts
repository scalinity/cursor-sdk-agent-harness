import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import fp from "fastify-plugin";
import { isLoopback } from "./bind-policy.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface OriginPolicyOptions {
  /**
   * Allowed origins. Phase 05 ships exactly one (the dev Vite origin); Phase 16
   * adds a second when running inside Electron so the renderer can load via
   * `app://harness/...`. Wildcards are never permitted.
   *
   * Back-compat: `allowedOrigin` accepts a single string. New callers should
   * use `allowedOrigins`.
   */
  allowedOrigin?: string;
  allowedOrigins?: ReadonlyArray<string>;
}

function isLoopbackIp(ip: string | undefined | null): boolean {
  if (!ip) return false;
  // Fastify may report ::ffff:127.0.0.1 for IPv4-mapped requests.
  const normalized = ip.replace(/^::ffff:/, "");
  return isLoopback(normalized);
}

const originPluginImpl: FastifyPluginAsync<OriginPolicyOptions> = async (
  app: FastifyInstance,
  opts: OriginPolicyOptions,
) => {
  const list = new Set<string>();
  if (opts.allowedOrigin) list.add(opts.allowedOrigin);
  for (const o of opts.allowedOrigins ?? []) list.add(o);
  if (list.size === 0) {
    throw new Error("origin policy requires at least one allowed origin");
  }

  app.addHook(
    "onRequest",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const origin = req.headers.origin;
      if (origin === undefined) {
        // Missing Origin is only acceptable for safe methods from loopback
        // (covers curl). Mutating methods MUST present Origin.
        if (!isLoopbackIp(req.ip) || MUTATING_METHODS.has(req.method)) {
          reply.code(403).send({ code: "ORIGIN_MISSING" });
        }
        return;
      }
      if (!list.has(origin)) {
        reply.code(403).send({ code: "ORIGIN_FORBIDDEN" });
      }
    },
  );
};

export const originPolicyPlugin = fp(originPluginImpl, {
  name: "harness-origin-policy",
});
