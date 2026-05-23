import type { FastifyInstance } from "fastify";
import type { CsrfTokenizer } from "../security/csrf.js";

export interface SecurityRoutesDeps {
  csrf: CsrfTokenizer;
}

export async function registerSecurityRoutes(
  app: FastifyInstance,
  deps: SecurityRoutesDeps,
): Promise<void> {
  app.get("/api/security/csrf-token", async () => ({
    token: deps.csrf.issue(),
  }));
}
