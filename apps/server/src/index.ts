import "dotenv/config";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { openDb } from "./db/client.js";
import { createRepositories } from "./db/repositories/index.js";
import { assertBindAllowed } from "./security/bind-policy.js";

async function main(): Promise<void> {
  const env = loadEnv();
  // env.ts already enforces this at parse time; the explicit assertion here
  // mirrors the rule near the bind call so future code can't drift.
  assertBindAllowed(env.HOST, env.ALLOW_REMOTE_BIND);

  const dbClient = openDb({ filePath: env.DB_PATH });
  dbClient.verifyMigrations();
  const repos = createRepositories(dbClient.raw);

  const { app } = await buildApp({ env, repos });

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    app.log.info(
      { host: env.HOST, port: env.PORT, webOrigin: env.WEB_ORIGIN },
      "cursor-sdk-agent-harness server listening",
    );
  } catch (err) {
    app.log.error({ err }, "failed to start server");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
