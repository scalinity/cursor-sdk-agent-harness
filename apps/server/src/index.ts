import "dotenv/config";
import { startServer } from "./programmatic.js";

type KeepAliveTimer = ReturnType<typeof setInterval>;

const state: {
  server: Awaited<ReturnType<typeof startServer>> | undefined;
  keepAlive: KeepAliveTimer | undefined;
} = { server: undefined, keepAlive: undefined };

async function main(): Promise<void> {
  try {
    state.server = await startServer();
    state.keepAlive = setInterval(() => undefined, 60_000);
  } catch (err) {
    console.error("failed to start server:", err);
    process.exit(1);
  }
}

async function shutdown(): Promise<void> {
  const server = state.server;
  const keepAlive = state.keepAlive;
  state.server = undefined;
  state.keepAlive = undefined;
  if (keepAlive !== undefined) clearInterval(keepAlive);
  try {
    await server?.close();
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
