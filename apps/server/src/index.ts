import "dotenv/config";
import { startServer } from "./programmatic.js";

async function main(): Promise<void> {
  try {
    await startServer();
  } catch (err) {
    console.error("failed to start server:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
