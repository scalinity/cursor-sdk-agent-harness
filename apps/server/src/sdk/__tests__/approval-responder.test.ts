import { describe, expect, it } from "vitest";
import { createLogger } from "../../logger.js";
import { ActiveRuns } from "../active-runs.js";
import {
  buildApprovalResponder,
  UnimplementedApprovalError,
} from "../approval-responder.js";
import type { RunController } from "../run-controller.js";
import type { Run } from "../sdk-adapter.js";

const silentLogger = createLogger("silent");

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

  it("RV2-W2: refuses to speculatively invoke a probed method even when one is available", async () => {
    // Future SDK that exposes `respond` — but with an unverified
    // signature. The responder must NOT call it, only detect it and
    // throw UnimplementedApprovalError. Verifying the signature is a
    // separate ledger step (OQ-10 positive resolution).
    let respondCalled = false;
    const fakeRun = {
      supports: () => true,
      stream: () => {
        throw new Error("unused");
      },
      wait: async () => ({ id: "x", status: "finished" as const }),
      cancel: async () => undefined,
      respond: async () => {
        respondCalled = true;
      },
    } as unknown as Run;
    const active = new ActiveRuns();
    active.register(stubController({ runId: "run-1", run: fakeRun }));
    const responder = buildApprovalResponder({ activeRuns: active, logger: silentLogger });
    await expect(
      responder.resolve({
        runId: "run-1",
        requestId: "req-2",
        decision: "deny",
        reason: "no thanks",
      }),
    ).rejects.toBeInstanceOf(UnimplementedApprovalError);
    expect(respondCalled).toBe(false);
  });

  it("RV2-W10: a probed method that would otherwise throw stays handled as unimplemented (locks current behaviour)", async () => {
    // After RV2-W2 the probe never calls the method, so a throwing
    // method is equivalent to a present-but-untrusted one. Lock the
    // contract so a future regression doesn't silently start
    // speculative invocation.
    const fakeRun = {
      supports: () => true,
      stream: () => {
        throw new Error("unused");
      },
      wait: async () => ({ id: "x", status: "finished" as const }),
      cancel: async () => undefined,
      respondToRequest: async () => {
        throw new Error("network down");
      },
    } as unknown as Run;
    const active = new ActiveRuns();
    active.register(stubController({ runId: "run-1", run: fakeRun }));
    const responder = buildApprovalResponder({ activeRuns: active, logger: silentLogger });
    await expect(
      responder.resolve({
        runId: "run-1",
        requestId: "req-3",
        decision: "approve",
      }),
    ).rejects.toBeInstanceOf(UnimplementedApprovalError);
  });
});
