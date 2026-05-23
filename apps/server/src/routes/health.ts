import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health/live", async () => ({ status: "ok" as const }));

  app.get("/api/health/ready", async () => ({
    status: "ok" as const,
    checks: { db: "skipped", keychain: "skipped" },
  }));

  app.get("/api/health/version", async () => ({
    status: "ok" as const,
    version: "0.0.0",
    phase: "02-monorepo-bootstrap",
  }));
}
