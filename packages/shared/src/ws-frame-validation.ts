/** Consecutive inbound WS frame validation failures before surfacing degraded state. */
export const FRAME_VALIDATION_FAILURE_THRESHOLD = 5;

export function frameDiscriminator(parsed: unknown): string {
  if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
    const type = (parsed as { type: unknown }).type;
    if (typeof type === "string") return type;
  }
  return "unknown";
}

export interface FrameValidationTracker {
  readonly consecutiveFailures: number;
  /** @returns true when the failure threshold was just crossed */
  recordValidationFailure(parsed: unknown): boolean;
  recordValidationSuccess(): void;
}

export function createFrameValidationTracker(onThreshold: () => void): FrameValidationTracker {
  let consecutiveFailures = 0;
  let degraded = false;
  return {
    get consecutiveFailures() {
      return consecutiveFailures;
    },
    recordValidationFailure(parsed: unknown) {
      consecutiveFailures += 1;
      const discriminator = frameDiscriminator(parsed);
      console.warn(
        `[ws] frame validation failed (${consecutiveFailures}/${FRAME_VALIDATION_FAILURE_THRESHOLD}): ${discriminator}`,
      );
      if (!degraded && consecutiveFailures >= FRAME_VALIDATION_FAILURE_THRESHOLD) {
        degraded = true;
        onThreshold();
        return true;
      }
      return false;
    },
    recordValidationSuccess() {
      consecutiveFailures = 0;
    },
  };
}
