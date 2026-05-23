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
   * The single allowed origin (e.g. `http://127.0.0.1:5173`). Wildcards are
   * never permitted. Additional origins should be added explicitly via env.
   */
  allowedOrigin: string;
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
  const { allowedOrigin } = opts;

  app.addHook(
    "onRequest",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const origin = req.headers.origin;
      if (origin === undefined) {
        // Missing Origin is only acceptable for safe methods from loopback
        // (covers curl). Mutating methods MUST present Origin.
        if (MUTATING_METHODS.has(req.method) && !isLoopbackIp(req.ip)) {
          reply.code(403).send({ code: "ORIGIN_MISSING" });
        }
        return;
      }
      if (origin !== allowedOrigin) {
        reply.code(403).send({ code: "ORIGIN_FORBIDDEN" });
      }
    },
  );
};

export const originPolicyPlugin = fp(originPluginImpl, {
  name: "harness-origin-policy",
});
