import type { FastifyBaseLogger } from "fastify";

/**
 * Minimal console-backed logger.
 *
 * This replaces the former Pino logger + redaction layer. The harness is a
 * personal, single-user local tool, so the structured-logging,
 * log-shipping, and secret-redaction machinery that came with Pino was
 * removed. What remains is just enough to surface operational warnings and
 * errors on the console.
 *
 * The object shape matches Fastify's `FastifyBaseLogger` so it can be
 * handed to Fastify via `loggerInstance`. Fastify's per-request access
 * logging is disabled separately (`disableRequestLogging: true`), so the
 * only things ever logged are explicit `logger.*` calls in our own
 * code — all of which pass safe, scalar-only objects (errors, ids), never
 * raw request headers, config blocks, or credentials. That is what lets us
 * drop redaction without re-introducing a secret-leak vector.
 */

export type LogLevel =
  | "silent"
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal";

const LEVEL_RANK: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Number.POSITIVE_INFINITY,
};

type ConsoleMethod = (...args: unknown[]) => void;

function consoleFor(level: string): ConsoleMethod {
  switch (level) {
    case "trace":
    case "debug":
      return console.debug.bind(console) as ConsoleMethod;
    case "warn":
      return console.warn.bind(console) as ConsoleMethod;
    case "error":
    case "fatal":
      return console.error.bind(console) as ConsoleMethod;
    default:
      return console.log.bind(console) as ConsoleMethod;
  }
}

function createConsoleLogger(
  initialLevel: LogLevel,
  bindings: Record<string, unknown>,
): FastifyBaseLogger {
  // Mutable so Fastify (or callers) can adjust verbosity via `log.level`.
  const state = { level: initialLevel };

  function emit(
    methodLevel: string,
    a: unknown,
    b?: unknown,
    rest: unknown[] = [],
  ): void {
    const threshold = LEVEL_RANK[state.level] ?? LEVEL_RANK.info ?? 30;
    if ((LEVEL_RANK[methodLevel] ?? 30) < threshold) return;
    const out = consoleFor(methodLevel);
    const tag = `[${methodLevel}]`;
    if (typeof a === "string") {
      out(tag, a, ...(b !== undefined ? [b, ...rest] : rest));
      return;
    }
    if (a !== null && typeof a === "object") {
      const merged =
        Object.keys(bindings).length > 0 ? { ...bindings, ...a } : a;
      const msg = typeof b === "string" ? b : "";
      out(tag, msg, merged, ...rest);
      return;
    }
    out(tag, a, b, ...rest);
  }

  // The cast through `unknown` is the deliberate boundary: our `(a, b,
  // ...rest)` signatures satisfy Fastify's overloaded `LogFn` at runtime,
  // but TS can't structurally prove the overload set, so we assert it once
  // here rather than littering every method with overloads.
  return {
    get level(): string {
      return state.level;
    },
    set level(value: string) {
      state.level = value as LogLevel;
    },
    fatal: (a: unknown, b?: unknown, ...rest: unknown[]) =>
      emit("fatal", a, b, rest),
    error: (a: unknown, b?: unknown, ...rest: unknown[]) =>
      emit("error", a, b, rest),
    warn: (a: unknown, b?: unknown, ...rest: unknown[]) =>
      emit("warn", a, b, rest),
    info: (a: unknown, b?: unknown, ...rest: unknown[]) =>
      emit("info", a, b, rest),
    debug: (a: unknown, b?: unknown, ...rest: unknown[]) =>
      emit("debug", a, b, rest),
    trace: (a: unknown, b?: unknown, ...rest: unknown[]) =>
      emit("trace", a, b, rest),
    silent: () => {},
    child(childBindings: Record<string, unknown>): FastifyBaseLogger {
      return createConsoleLogger(state.level, { ...bindings, ...childBindings });
    },
  } as unknown as FastifyBaseLogger;
}

/** Build the application logger handed to Fastify as `loggerInstance`. */
export function createLogger(level: LogLevel = "info"): FastifyBaseLogger {
  return createConsoleLogger(level, {});
}

export type AppLogger = FastifyBaseLogger;
