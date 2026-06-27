import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inkMock = vi.hoisted(() => ({
  render: vi.fn(),
}));

vi.mock("ink", () => ({
  render: inkMock.render,
}));

const { renderFullscreenApp } = await import("../../src/repl/tui-lifecycle.js");

const ENTER_SEQUENCE = "[?1049h[2J[?25l[?1000h[?1006h";
const EXIT_SEQUENCE = "[?1006l[?1000l[?25h[?1049l";

function setStdoutTty(value: boolean | undefined): void {
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value });
}

function createDeferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createInkInstance(waitUntilExit: () => Promise<void>) {
  return {
    waitUntilExit: vi.fn(waitUntilExit),
    cleanup: vi.fn(),
    unmount: vi.fn(),
  };
}

describe("renderFullscreenApp", () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;
  const originalIsTTY = process.stdout.isTTY;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    inkMock.render.mockReset();
    process.exitCode = undefined;
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
    setStdoutTty(originalIsTTY);
    process.exitCode = originalExitCode;
  });

  it("does not enter alternate screen for non-TTY output", async () => {
    setStdoutTty(false);
    const instance = createInkInstance(() => Promise.resolve());
    inkMock.render.mockReturnValue(instance);

    await renderFullscreenApp(React.createElement("div"));

    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(instance.cleanup).toHaveBeenCalledTimes(1);
  });

  it("restores alternate screen and mouse mode when Ink render startup throws", async () => {
    setStdoutTty(true);
    inkMock.render.mockImplementation(() => {
      throw new Error("raw mode failed");
    });

    await renderFullscreenApp(React.createElement("div"));

    expect(stdoutWrite.mock.calls.map((call) => call[0])).toEqual([ENTER_SEQUENCE, EXIT_SEQUENCE]);
    expect(stderrWrite).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("runs cleanup, unmounts, and restores on SIGINT", async () => {
    setStdoutTty(true);
    const deferred = createDeferred();
    const instance = createInkInstance(() => deferred.promise);
    const onExit = vi.fn();
    inkMock.render.mockReturnValue(instance);

    const renderPromise = renderFullscreenApp(React.createElement("div"), { onExit });
    process.emit("SIGINT");
    deferred.resolve();
    await renderPromise;

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(instance.unmount).toHaveBeenCalledTimes(1);
    expect(instance.cleanup).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(130);
    expect(stdoutWrite.mock.calls.map((call) => call[0])).toContain(EXIT_SEQUENCE);
  });
});
