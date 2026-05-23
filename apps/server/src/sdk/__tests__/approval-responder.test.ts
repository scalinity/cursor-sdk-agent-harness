import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { ActiveRuns } from "../active-runs.js";
import {
  buildApprovalResponder,
  UnimplementedApprovalError,
} from "../approval-responder.js";
import type { RunController } from "../run-controller.js";
import type { Run } from "../sdk-adapter.js";

const silentLogger = pino({ level: "silent" });

/**
 * Build a minimal stub controller. The responder reaches in via
 * `getRunHandle()` and never touches anything else.
 */
function stubController(opts: {
  runId: string;
  run: Run | null;
}): RunController {
  return {
    runId: opts.runId,
    agentId: "agent-x",
    getRunHandle: () => opts.run,
  } as unknown as RunController;
}

describe("approval-responder", () => {
  it("throws UnimplementedApprovalError when the run has no controller", async () => {
    const active = new ActiveRuns();
    const responder = buildApprovalResponder({ activeRuns: active, logger: silentLogger });
    await expect(
      responder.resolve({
        runId: "unknown",
        requestId: "req-1",
        decision: "approve",
      }),
    ).rejects.toBeInstanceOf(UnimplementedApprovalError);
  });

  it("throws UnimplementedApprovalError when the controller has no Run handle yet", async () => {
    const active = new ActiveRuns();
    active.register(stubController({ runId: "run-1", run: null }));
    const responder = buildApprovalResponder({ activeRuns: active, logger: silentLogger });
    await expect(
      responder.resolve({ runId: "run-1", requestId: "req-1", decision: "approve" }),
    ).rejects.toBeInstanceOf(UnimplementedApprovalError);
  });

  it("throws UnimplementedApprovalError when the Run handle has no known resolver method (SDK 1.0.13)", async () => {
    const fakeRun: Partial<Run> = {
      supports: () => true,
      stream: () => {
        throw new Error("unused");
      },
      wait: async () => ({ id: "x", status: "finished" as const }),
      cancel: async () => undefined,
    };
    const active = new ActiveRuns();
    active.register(
      stubController({ runId: "run-1", run: fakeRun as Run }),
    );
    const responder = buildApprovalResponder({ activeRuns: active, logger: silentLogger });
    await expect(
      responder.resolve({ runId: "run-1", requestId: "req-1", decision: "approve" }),
    ).rejects.toBeInstanceOf(UnimplementedApprovalError);
  });

  it("calls the probed method when one is available (future SDK)", async () => {
    let received: { id: string; decision: string; reason?: string } | null = null;
    const fakeRun = {
      supports: () => true,
      stream: () => {
        throw new Error("unused");
      },
      wait: async () => ({ id: "x", status: "finished" as const }),
      cancel: async () => undefined,
      respond: async (
        requestId: string,
        decision: "approve" | "deny",
        opts: { reason?: string },
      ) => {
        received = { id: requestId, decision, ...(opts.reason !== undefined ? { reason: opts.reason } : {}) };
      },
    } as unknown as Run;
    const active = new ActiveRuns();
    active.register(stubController({ runId: "run-1", run: fakeRun }));
    const responder = buildApprovalResponder({ activeRuns: active, logger: silentLogger });
    await responder.resolve({
      runId: "run-1",
      requestId: "req-2",
      decision: "deny",
      reason: "no thanks",
    });
    expect(received).toEqual({ id: "req-2", decision: "deny", reason: "no thanks" });
  });
});
