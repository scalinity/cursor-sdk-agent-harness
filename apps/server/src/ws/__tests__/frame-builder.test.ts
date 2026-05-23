import { describe, expect, it, vi } from "vitest";
import type { EventRow } from "@harness/shared";
import { buildServerFrame } from "../frame-builder.js";

function row(partial: Partial<EventRow>): EventRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    runId: "run-1",
    agentId: "agent-1",
    seq: 1,
    schemaVersion: 1,
    sdkType: "system",
    kind: "system.init",
    callId: null,
    requestId: null,
    status: null,
    payload: { mode: "local" },
    raw: null,
    payloadBytes: 32,
    rawBytes: 0,
    occurredAt: "2026-05-23T10:00:00.000Z",
    receivedAt: "2026-05-23T10:00:00.000Z",
    createdAt: "2026-05-23T10:00:00.000Z",
    ...partial,
  };
}

describe("buildServerFrame — kind coverage", () => {
  it("returns null without warning for non-broadcast kinds (system.unknown_sdk_message)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const frame = buildServerFrame(
      row({ kind: "system.unknown_sdk_message", sdkType: "system" }),
    );
    expect(frame).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns when a truly unknown kind reaches the builder", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const frame = buildServerFrame(
      row({ kind: "not.a.real.kind", sdkType: "system" }),
    );
    expect(frame).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    const message = warn.mock.calls[0]?.[0];
    expect(typeof message).toBe("string");
    expect(message as string).toContain("unknown canonical event kind");
    warn.mockRestore();
  });

  it("emits a server frame for system.init", () => {
    const frame = buildServerFrame(row({ kind: "system.init" }));
    expect(frame).not.toBeNull();
    expect(frame?.type).toBe("sdk.system");
  });

  it("marks replayed=true when opts.replayed is set", () => {
    const frame = buildServerFrame(row({ kind: "system.init" }), { replayed: true });
    expect((frame as unknown as { replayed?: boolean }).replayed).toBe(true);
  });

  it("does NOT include replayed key for live frames", () => {
    const frame = buildServerFrame(row({ kind: "system.init" }));
    expect((frame as unknown as { replayed?: boolean }).replayed).toBeUndefined();
  });
});
