import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSessionSnapshot,
  isCliSessionSnapshot,
  readLastSession,
  writeLastSession,
} from "../src/session.js";

describe("CLI session resume", () => {
  const tempDirs: string[] = [];
  let sessionPath = "";

  afterEach(async () => {
    if (sessionPath) {
      await rm(sessionPath, { force: true });
      sessionPath = "";
    }
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("validates saved session snapshots", () => {
    const snapshot = createSessionSnapshot({
      workspace: "/tmp/project",
      agent: { id: "agent-1", name: "CLI", modelId: "composer-2-5-fast", executionMode: "agent" },
      mode: "agent",
      modelId: "composer-2-5-fast",
      sessionCost: { micros: 1000, hasUnavailableTurn: false },
      buffer: { items: [{ type: "user", text: "hello", at: "12:00" }] },
      scrollOffset: 2,
    });
    expect(isCliSessionSnapshot(snapshot)).toBe(true);
    expect(isCliSessionSnapshot({ version: 2 })).toBe(false);
  });

  it("writes and reads the last saved session", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-cli-session-"));
    tempDirs.push(dir);
    sessionPath = path.join(dir, "last-session.json");
    process.env.HARNESS_CLI_SESSION_PATH = sessionPath;

    const snapshot = createSessionSnapshot({
      workspace: dir,
      agent: { id: "agent-1", name: "CLI", modelId: "composer-2-5-fast", executionMode: "ask" },
      mode: "ask",
      modelId: "composer-2-5-fast",
      sessionCost: { micros: 0, hasUnavailableTurn: true },
      buffer: { items: [{ type: "assistant", text: "Hi there" }] },
      scrollOffset: 0,
    });

    await writeLastSession(snapshot);
    const loaded = await readLastSession();
    expect(loaded).toEqual(snapshot);

    delete process.env.HARNESS_CLI_SESSION_PATH;
  });
});
