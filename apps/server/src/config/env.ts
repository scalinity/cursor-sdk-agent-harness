import { z } from "zod";
import os from "node:os";
import path from "node:path";

const DEFAULT_DB_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "cursor-sdk-agent-harness",
);

const envSchema = z
  .object({
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4783),
    WEB_ORIGIN: z.string().url().default("http://127.0.0.1:5173"),
    DB_PATH: z.string().min(1).default(path.join(DEFAULT_DB_DIR, "harness.sqlite")),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    KEYCHAIN_SERVICE: z.string().min(1).default("cursor-sdk-agent-harness"),
    CURSOR_API_KEY: z.string().min(1).optional(),
    ALLOW_REMOTE_BIND: z
      .string()
      .transform((v) => v.toLowerCase() === "true")
      .default("false"),
  })
  .superRefine((val, ctx) => {
    if (val.HOST !== "127.0.0.1" && val.HOST !== "localhost" && !val.ALLOW_REMOTE_BIND) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["HOST"],
        message:
          "Non-loopback HOST requires ALLOW_REMOTE_BIND=true. Refusing to bind for safety.",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  return parsed.data;
}
