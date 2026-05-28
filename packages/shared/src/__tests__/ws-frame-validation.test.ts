import { describe, expect, it, vi } from "vitest";
import {
  createFrameValidationTracker,
  FRAME_VALIDATION_FAILURE_THRESHOLD,
  frameDiscriminator,
} from "../ws-frame-validation.js";

describe("ws-frame-validation", () => {
  it("frameDiscriminator reads type or returns unknown", () => {
    expect(frameDiscriminator({ type: "heartbeat" })).toBe("heartbeat");
    expect(frameDiscriminator({})).toBe("unknown");
    expect(frameDiscriminator(null)).toBe("unknown");
  });

  it("fires onThreshold after N consecutive failures and resets on success", () => {
    const onThreshold = vi.fn();
    const tracker = createFrameValidationTracker(onThreshold);
    for (let i = 0; i < FRAME_VALIDATION_FAILURE_THRESHOLD - 1; i++) {
      expect(tracker.recordValidationFailure({ type: "bad" })).toBe(false);
    }
    expect(tracker.recordValidationSuccess()).toBeUndefined();
    expect(tracker.consecutiveFailures).toBe(0);
    for (let i = 0; i < FRAME_VALIDATION_FAILURE_THRESHOLD; i++) {
      const crossed = tracker.recordValidationFailure({ type: "bad" });
      if (i === FRAME_VALIDATION_FAILURE_THRESHOLD - 1) {
        expect(crossed).toBe(true);
      } else {
        expect(crossed).toBe(false);
      }
    }
    expect(onThreshold).toHaveBeenCalledTimes(1);
    tracker.recordValidationSuccess();
    expect(tracker.consecutiveFailures).toBe(0);
  });
});
