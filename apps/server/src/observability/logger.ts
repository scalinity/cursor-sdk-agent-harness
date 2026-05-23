import { pino, stdTimeFunctions, type Logger, type LoggerOptions } from "pino";

const REDACT_PATHS = [
  "apiKey",
  "CURSOR_API_KEY",
  "Authorization",
  "*.token",
  "*.secret",
  "*.password",
  "*.key",
  "req.headers.authorization",
  "req.headers.cookie",
];

export function createLogger(level: LoggerOptions["level"] = "info"): Logger {
  return pino({
    level,
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },
    base: { service: "cursor-sdk-agent-harness" },
    timestamp: stdTimeFunctions.isoTime,
  });
}

export type AppLogger = Logger;
