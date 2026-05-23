import path from "node:path";
import os from "node:os";
import type { Config } from "drizzle-kit";

const dbPath =
  process.env["DB_PATH"] ??
  path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "cursor-sdk-agent-harness",
    "harness.sqlite",
  );

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
  strict: true,
} satisfies Config;
