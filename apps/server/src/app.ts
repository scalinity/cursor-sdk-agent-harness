import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { registerRoutes } from "./routes/index.js";
import type { Env } from "./config/env.js";

export type AppDeps = {
  env: Env;
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps;

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          "apiKey",
          "CURSOR_API_KEY",
          "Authorization",
          "*.token",
          "*.secret",
          "*.password",
          "*.key",
          "req.headers.authorization",
          "req.headers.cookie",
        ],
        censor: "[REDACTED]",
      },
      base: { service: "cursor-sdk-agent-harness" },
    },
    disableRequestLogging: false,
    trustProxy: false,
  });

  await app.register(cors, {
    origin: [env.WEB_ORIGIN],
    credentials: true,
  });

  await app.register(websocket);

  await registerRoutes(app);

  return app;
}
