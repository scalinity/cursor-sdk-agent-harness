import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliHttpError } from "../src/client/http.js";
import {
  CliUsageError,
  formatCliError,
  installFatalErrorHandlers,
  isCursorConnectionError,
  registerFatalShutdownHook,
  resetFatalErrorStateForTests,
  runFatalShutdown,
} from "../src/errors.js";

describe("formatCliError", () => {
  const networkError = new CliHttpError("network error", 0, "NETWORK_ERROR", null);

  it("guides embedded-mode network failures without telling the user to start a server", () => {
    const { message, exitCode } = formatCliError(networkError, "http://127.0.0.1:4783", true);
    expect(message).toContain("embedded");
    expect(message).not.toContain("pnpm start:server");
    expect(exitCode).toBe(2);
  });

  it("points external-server network failures at the configured URL", () => {
    const { message, exitCode } = formatCliError(networkError, "http://127.0.0.1:9999", false);
    expect(message).toContain("http://127.0.0.1:9999");
    expect(message).toContain("pnpm start:server");
    expect(exitCode).toBe(2);
  });

  it("passes usage errors through unchanged", () => {
    const { message, exitCode } = formatCliError(new CliUsageError("bad flag"));
    expect(message).toBe("bad flag");
    expect(exitCode).toBe(1);
  });

  it("maps ConnectError / ECONNRESET to a readable network message", () => {
    const connectError = new Error("[aborted] read ECONNRESET");
    connectError.name = "ConnectError";
    expect(isCursorConnectionError(connectError)).toBe(true);
    const { message, exitCode } = formatCliError(connectError);
    expect(message).toContain("Lost connection to Cursor");
    expect(exitCode).toBe(1);
  });

  it("maps SDK NetworkError names to connection failures", () => {
    const networkError = new Error("upstream unavailable");
    networkError.name = "NetworkError";
    expect(isCursorConnectionError(networkError)).toBe(true);
    expect(formatCliError(networkError).message).toContain("Lost connection to Cursor");
  });

  it("maps SDK 502 envelopes that wrap connection resets", () => {
    const wrapped = new CliHttpError("[aborted] read ECONNRESET", 502, "SDK_SEND_FAILED", null);
    const { message } = formatCliError(wrapped);
    expect(message).toContain("Lost connection to Cursor");
  });

  it("does not map unrelated SDK 502 failures to connection resets", () => {
    const wrapped = new CliHttpError("Invalid model id", 502, "SDK_CREATE_FAILED", null);
    expect(formatCliError(wrapped).message).toBe("Invalid model id");
  });
});

describe("fatal shutdown hooks", () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetFatalErrorStateForTests();
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    resetFatalErrorStateForTests();
  });

  it("runs registered hooks and restores the terminal", async () => {
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    const hook = vi.fn(async () => {});
    registerFatalShutdownHook(hook);
    await runFatalShutdown();
    expect(hook).toHaveBeenCalledTimes(1);
    expect(stdoutWrite).toHaveBeenCalledWith("\u001b[?1006l\u001b[?1000l\u001b[?25h\u001b[?1049l");
  });

  it("is idempotent when shutdown runs more than once", async () => {
    const hook = vi.fn(async () => {});
    registerFatalShutdownHook(hook);
    await runFatalShutdown();
    await runFatalShutdown();
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("installs fatal handlers only once", () => {
    const before = process.listenerCount("unhandledRejection");
    installFatalErrorHandlers();
    installFatalErrorHandlers();
    expect(process.listenerCount("unhandledRejection")).toBe(before + 1);
  });
});
