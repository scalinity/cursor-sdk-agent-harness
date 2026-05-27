import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    delete process.env.HARNESS_CLI_SESSION_PATH;
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
      sessionTokens: { tokens: 30, hasUnavailableTurn: false },
      buffer: { items: [{ type: "user", text: "hello", at: "12:00" }] },
      scrollOffset: 2,
    });
    expect(isCliSessionSnapshot(snapshot)).toBe(true);
    expect(isCliSessionSnapshot({ version: 2 })).toBe(false);
  });

  it("rejects saved sessions with unknown stream item shapes", () => {
    expect(isCliSessionSnapshot({
      version: 1,
      savedAt: "2026-05-27T00:00:00.000Z",
      workspace: "/tmp/project",
      agent: { id: "agent-1", name: "CLI", modelId: "composer-2-5-fast", executionMode: "agent" },
      mode: "agent",
      modelId: "composer-2-5-fast",
      sessionCost: { micros: 0, hasUnavailableTurn: false },
      sessionTokens: { tokens: 0, hasUnavailableTurn: false },
      buffer: { items: [{ type: "mystery", text: "nope" }] },
      scrollOffset: 0,
    })).toBe(false);
  });

  it("bounds and redacts persisted resume transcript text", () => {
    const passwordLike = ["pass", "word=topvalue"].join("");
    const apiKeyLike = ["s", "k-test-value"].join("");
    const snapshot = createSessionSnapshot({
      workspace: "/tmp/project",
      agent: { id: "agent-1", name: "CLI", modelId: "composer-2-5-fast", executionMode: "agent" },
      mode: "agent",
      modelId: "composer-2-5-fast",
      sessionCost: { micros: 0, hasUnavailableTurn: false },
      sessionTokens: { tokens: 0, hasUnavailableTurn: false },
      buffer: {
        items: Array.from({ length: 205 }, (_, index) => ({
          type: "user" as const,
          text: index === 204 ? `${passwordLike} ${apiKeyLike}` : `line-${index}`,
          at: "12:00",
        })),
      },
      scrollOffset: 999999,
    });

    expect(snapshot.buffer.items).toHaveLength(200);
    expect(snapshot.scrollOffset).toBe(50000);
    expect(snapshot.buffer.items.at(-1)).toMatchObject({ text: "[redacted] [redacted]" });
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
      sessionTokens: { tokens: 42, hasUnavailableTurn: false },
      buffer: { items: [{ type: "assistant", text: "Hi there" }] },
      scrollOffset: 0,
    });

    await writeLastSession(snapshot);
    const loaded = await readLastSession();
    expect(loaded).toEqual(snapshot);
    const raw = JSON.parse(await readFile(sessionPath, "utf8")) as { sessionTokens?: unknown };
    expect(raw.sessionTokens).toEqual({ tokens: 42, hasUnavailableTurn: false });

    delete process.env.HARNESS_CLI_SESSION_PATH;
  });

  it("derives token totals when resuming an older saved session", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-cli-session-"));
    tempDirs.push(dir);
    sessionPath = path.join(dir, "last-session.json");
    process.env.HARNESS_CLI_SESSION_PATH = sessionPath;

    await writeFile(sessionPath, `${JSON.stringify({
      version: 1,
      savedAt: "2026-05-27T00:00:00.000Z",
      workspace: dir,
      agent: { id: "agent-1", name: "CLI", modelId: "composer-2-5-fast", executionMode: "ask" },
      mode: "ask",
      modelId: "composer-2-5-fast",
      sessionCost: { micros: 2500, hasUnavailableTurn: false },
      buffer: { items: [{ type: "summary", status: "FINISHED", tokens: 30, costMicros: 2500, durationMs: 1200 }] },
      scrollOffset: 0,
    })}\n`);

    const loaded = await readLastSession();
    expect(loaded?.sessionTokens).toEqual({ tokens: 30, hasUnavailableTurn: false });
  });

  it("preserves partial token state when deriving totals from older saved sessions", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-cli-session-"));
    tempDirs.push(dir);
    sessionPath = path.join(dir, "last-session.json");
    process.env.HARNESS_CLI_SESSION_PATH = sessionPath;

    await writeFile(sessionPath, `${JSON.stringify({
      version: 1,
      savedAt: "2026-05-27T00:00:00.000Z",
      workspace: dir,
      agent: { id: "agent-1", name: "CLI", modelId: "composer-2-5-fast", executionMode: "ask" },
      mode: "ask",
      modelId: "composer-2-5-fast",
      sessionCost: { micros: 0, hasUnavailableTurn: true },
      buffer: { items: [{ type: "summary", status: "FINISHED", tokens: 10, tokensPartial: true, costMicros: null, costUnavailable: true, durationMs: 900 }] },
      scrollOffset: 0,
    })}\n`);

    const loaded = await readLastSession();
    expect(loaded?.sessionTokens).toEqual({ tokens: 10, hasUnavailableTurn: true });
  });

  it("rejects corrupt saved session JSON instead of treating it as missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-cli-session-"));
    tempDirs.push(dir);
    sessionPath = path.join(dir, "last-session.json");
    process.env.HARNESS_CLI_SESSION_PATH = sessionPath;
    await writeFile(sessionPath, "{not json\n");

    await expect(readLastSession()).rejects.toThrow(/corrupt/i);
  });

  it("rejects saved sessions with invalid stream items", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-cli-session-"));
    tempDirs.push(dir);
    sessionPath = path.join(dir, "last-session.json");
    process.env.HARNESS_CLI_SESSION_PATH = sessionPath;
    await writeFile(sessionPath, `${JSON.stringify({
      version: 1,
      savedAt: "2026-05-27T00:00:00.000Z",
      workspace: dir,
      agent: { id: "agent-1", name: "CLI", modelId: "composer-2-5-fast", executionMode: "ask" },
      mode: "ask",
      modelId: "composer-2-5-fast",
      sessionCost: { micros: 2500, hasUnavailableTurn: false },
      sessionTokens: { tokens: 1, hasUnavailableTurn: false },
      buffer: { items: [{ type: "assistant" }] },
      scrollOffset: 0,
    })}\n`);

    await expect(readLastSession()).rejects.toThrow(/unsupported|corrupt/i);
  });
});
