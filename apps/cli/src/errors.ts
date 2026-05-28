import { CliHttpError } from "./client/http.js";
import { restoreTerminal } from "./repl/tui-lifecycle.js";

export class CliUsageError extends Error {
  readonly exitCode = 1;

  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const CURSOR_CONNECTION_RESET_MESSAGE =
  "Lost connection to Cursor while the agent was running. This is usually a transient network issue — check your internet connection, disable VPN/proxy if enabled, and run `harness` again.";

const SDK_FAILURE_CODES = new Set(["SDK_SEND_FAILED", "SDK_CREATE_FAILED", "SDK_RESUME_FAILED"]);

export function isCursorConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "ConnectError" || error.name === "NetworkError") return true;
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up/i.test(error.message)) return true;
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined && cause !== error) return isCursorConnectionError(cause);
  return false;
}

function isSdkGatewayFailure(error: CliHttpError): boolean {
  return error.status === 502 && error.code !== null && SDK_FAILURE_CODES.has(error.code);
}

export function formatCliError(error: unknown, serverUrl?: string, embedded = false): { message: string; exitCode: number } {
  if (error instanceof CliUsageError) {
    return { message: error.message, exitCode: error.exitCode };
  }
  if (error instanceof CliHttpError && error.code === "NETWORK_ERROR") {
    return {
      message: embedded
        ? "The embedded harness server stopped responding. Re-run `harness`, or pass --server <url> to attach to an external server."
        : `Cannot connect to harness server at ${serverUrl ?? "the configured URL"}. Start it with: pnpm start:server`,
      exitCode: 2,
    };
  }
  if (error instanceof CliHttpError && isSdkGatewayFailure(error) && isCursorConnectionError(error)) {
    return { message: CURSOR_CONNECTION_RESET_MESSAGE, exitCode: 1 };
  }
  if (isCursorConnectionError(error)) {
    return { message: CURSOR_CONNECTION_RESET_MESSAGE, exitCode: 1 };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    exitCode: 1,
  };
}

type FatalShutdownHook = () => void | Promise<void>;

const shutdownHooks = new Set<FatalShutdownHook>();
let fatalErrorHandlersInstalled = false;
let shuttingDown = false;
let handlingFatal = false;

export function registerFatalShutdownHook(hook: FatalShutdownHook): () => void {
  shutdownHooks.add(hook);
  return () => {
    shutdownHooks.delete(hook);
  };
}

export async function runFatalShutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const hook of [...shutdownHooks]) {
    try {
      await hook();
    } catch {
      // best-effort teardown
    }
  }
  shutdownHooks.clear();
  restoreTerminal();
}

/** Test-only reset so handler state does not leak across vitest cases. */
export function resetFatalErrorStateForTests(): void {
  shutdownHooks.clear();
  fatalErrorHandlersInstalled = false;
  shuttingDown = false;
  handlingFatal = false;
}

/** Prevents raw ConnectRPC stack traces from killing the embedded CLI process. */
export function installFatalErrorHandlers(): void {
  if (fatalErrorHandlersInstalled) return;
  fatalErrorHandlersInstalled = true;

  const reportAndExit = (label: string, error: unknown) => {
    if (handlingFatal) return;
    handlingFatal = true;
    void (async () => {
      await runFatalShutdown();
      const { message, exitCode } = formatCliError(error);
      if (process.stderr.writable) {
        process.stderr.write(`${label}: ${message}\n`);
      }
      process.exitCode = exitCode;
      process.exit(exitCode);
    })();
  };

  process.on("unhandledRejection", (reason) => {
    reportAndExit("Unhandled error", reason);
  });
  process.on("uncaughtException", (error) => {
    reportAndExit("Fatal error", error);
  });
}
