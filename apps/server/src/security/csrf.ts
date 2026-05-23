import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import fp from "fastify-plugin";

export const CSRF_HEADER = "x-csrf-token";
/**
 * 4-hour TTL. The harness is single-user/local, but we still cap the replay
 * window. The web client refreshes the token on every app load and can call
 * `/api/security/csrf-token` again when a mutating request returns 403
 * `CSRF_FAILED`. If a future phase introduces non-local clients, drop the TTL
 * further (≤30 min) and rotate the Keychain secret on demand.
 */
export const CSRF_TOKEN_TTL_SEC = 4 * 60 * 60;

/**
 * CSRF token = `${nonceB64u}.${expSec}.${hmacB64u}`. The HMAC is computed over
 * `${nonceB64u}.${expSec}` using a Keychain-stored secret. Single-user local
 * app — this is sufficient to bind requests to a session that knows the
 * shared secret without round-tripping cookies.
 */
export class CsrfTokenizer {
  constructor(private readonly secret: string) {
    if (!secret || secret.length < 16) {
      throw new Error("CsrfTokenizer: secret is too short");
    }
  }

  issue(now: Date = new Date()): string {
    const nonce = randomBytes(16).toString("base64url");
    const exp = Math.floor(now.getTime() / 1000) + CSRF_TOKEN_TTL_SEC;
    const payload = `${nonce}.${exp}`;
    const sig = this.sign(payload);
    return `${payload}.${sig}`;
  }

  /**
   * Returns true when the token signature is valid AND not expired.
   * Constant-time HMAC comparison.
   */
  validate(token: string, now: Date = new Date()): boolean {
    if (typeof token !== "string" || token.length === 0) return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [nonce, expStr, sig] = parts as [string, string, string];
    if (!nonce || !expStr || !sig) return false;

    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp <= 0) return false;
    if (Math.floor(now.getTime() / 1000) > exp) return false;

    const expected = this.sign(`${nonce}.${expStr}`);
    const a = Buffer.from(sig, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface CsrfPluginOptions {
  tokenizer: CsrfTokenizer;
  /**
   * Routes that are exempt from CSRF validation (e.g. `/api/security/csrf-token`
   * itself is GET so it's already exempt, but other bootstrap routes can go
   * here if needed).
   */
  exemptUrls?: string[];
}

const csrfPluginImpl: FastifyPluginAsync<CsrfPluginOptions> = async (
  app: FastifyInstance,
  opts: CsrfPluginOptions,
) => {
  const { tokenizer } = opts;
  const exempt = new Set(opts.exemptUrls ?? []);

  app.decorate("csrf", tokenizer);

  app.addHook(
    "preValidation",
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!MUTATING_METHODS.has(req.method)) return;
      // routerPath is the matched route template; routeOptions.url is also stable.
      const routeUrl = (req.routeOptions?.url ?? req.url).split("?")[0] ?? "";
      if (exempt.has(routeUrl)) return;
      const token = req.headers[CSRF_HEADER];
      const value = Array.isArray(token) ? token[0] : token;
      if (!value || !tokenizer.validate(value)) {
        reply.code(403).send({ code: "CSRF_FAILED" });
      }
    },
  );
};

export const csrfPlugin = fp(csrfPluginImpl, {
  name: "harness-csrf",
});

declare module "fastify" {
  interface FastifyInstance {
    csrf: CsrfTokenizer;
  }
}
