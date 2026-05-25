import { CliHttpError } from "./client/http.js";

export class CliUsageError extends Error {
  readonly exitCode = 1;

  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function formatCliError(error: unknown, serverUrl?: string): { message: string; exitCode: number } {
  if (error instanceof CliUsageError) {
    return { message: error.message, exitCode: error.exitCode };
  }
  if (error instanceof CliHttpError && error.code === "NETWORK_ERROR") {
    return {
      message: `Cannot connect to harness server at ${serverUrl ?? "the configured URL"}. Start it with: pnpm start:server`,
      exitCode: 2,
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    exitCode: 1,
  };
}
