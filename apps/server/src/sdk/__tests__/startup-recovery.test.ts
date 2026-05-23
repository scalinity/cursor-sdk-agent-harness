import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { runStartupRecovery } from "../startup-recovery.js";

const silentLogger = pino({ level: "silent" });

describe("startup-recovery", () => {
  it("finalizes RUNNING runs with a run.interrupted event and status flip", () => {
    const db = openTestDb();
    const repos = createRepositories(db.raw);
    const agent = repos.agents.create({
      name: "a",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
      cwd: ["/tmp/x"],
      mcpServerIds: [],
      subagentDefinitionIds: [],
    });
    const run = repos.runs.create({
      agentId: agent.id,
      status: "RUNNING",
      promptPreview: "prompt",
      modelId: "composer-2-5-fast",
      mode: "local",
    });

    const result = runStartupRecovery({
      runs: repos.runs,
      events: repos.events,
      logger: silentLogger,
    });

    expect(result.recoveredRunIds).toEqual([run.id]);
    const stored = repos.runs.getById(run.id);
    expect(stored?.status).toBe("ERROR");
    expect(stored?.interruptedReason).toBe("server_restart");

    const events = repos.events.getAllByRunId(run.id);
    expect(events).toHaveLength(1);
    const evt = events[0]!;
    expect(evt.kind).toBe("run.interrupted");
    expect(evt.sdkType).toBe("status");
    const payload = evt.payload as { reason: string };
    expect(payload.reason).toBe("server_restart");
    db.raw.close();
  });

  it("leaves terminal runs untouched", () => {
    const db = openTestDb();
    const repos = createRepositories(db.raw);
    const agent = repos.agents.create({
      name: "a",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
      cwd: ["/tmp/x"],
      mcpServerIds: [],
      subagentDefinitionIds: [],
    });
    const finishedRun = repos.runs.create({
      agentId: agent.id,
      status: "FINISHED",
      promptPreview: "p",
      modelId: "composer-2-5-fast",
      mode: "local",
    });
    const cancelledRun = repos.runs.create({
      agentId: agent.id,
      status: "CANCELLED",
      promptPreview: "p",
      modelId: "composer-2-5-fast",
      mode: "local",
    });

    const result = runStartupRecovery({
      runs: repos.runs,
      events: repos.events,
      logger: silentLogger,
    });

    expect(result.recoveredRunIds).toEqual([]);
    expect(repos.runs.getById(finishedRun.id)?.status).toBe("FINISHED");
    expect(repos.runs.getById(cancelledRun.id)?.status).toBe("CANCELLED");
    expect(repos.events.getAllByRunId(finishedRun.id)).toHaveLength(0);
    expect(repos.events.getAllByRunId(cancelledRun.id)).toHaveLength(0);
    db.raw.close();
  });

  it("is idempotent — a second run finds nothing to recover", () => {
    const db = openTestDb();
    const repos = createRepositories(db.raw);
    const agent = repos.agents.create({
      name: "a",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
      cwd: ["/tmp/x"],
      mcpServerIds: [],
      subagentDefinitionIds: [],
    });
    repos.runs.create({
      agentId: agent.id,
      status: "RUNNING",
      promptPreview: "p",
      modelId: "composer-2-5-fast",
      mode: "local",
    });

    runStartupRecovery({ runs: repos.runs, events: repos.events, logger: silentLogger });
    const second = runStartupRecovery({
      runs: repos.runs,
      events: repos.events,
      logger: silentLogger,
    });

    expect(second.recoveredRunIds).toEqual([]);
    db.raw.close();
  });
});
