import "dotenv/config";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp({ env });

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
