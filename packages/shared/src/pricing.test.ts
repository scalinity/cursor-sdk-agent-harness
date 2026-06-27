import { describe, expect, it } from "vitest";
import { cursorModelRateMicros, dollarsPerMillionToMicros } from "./pricing.js";

const M = dollarsPerMillionToMicros;

describe("cursorModelRateMicros", () => {
  // Rates transcribed from cursor.com/docs/models (input, output, cached input).
  it.each([
    ["claude-opus-4-8", M(5.0), M(25.0), M(0.5)],
    ["claude-opus-4-5", M(5.0), M(25.0), M(0.5)],
    ["claude-sonnet-4-6", M(3.0), M(15.0), M(0.3)],
    ["claude-sonnet-4", M(3.0), M(15.0), M(0.3)],
    ["claude-haiku-4-5", M(1.0), M(5.0), M(0.1)],
    ["claude-fable-5", M(10.0), M(50.0), M(1.0)],
    ["gpt-5.5", M(5.0), M(30.0), M(0.5)],
    ["gpt-5.4", M(2.5), M(15.0), M(0.25)],
    ["gpt-5.4-mini", M(0.75), M(4.5), M(0.075)],
    ["gpt-5.4-nano", M(0.2), M(1.25), M(0.02)],
    ["gpt-5.3-codex", M(1.75), M(14.0), M(0.175)],
    ["gpt-5.2-codex", M(1.75), M(14.0), M(0.175)],
    ["gpt-5.1-codex", M(1.25), M(10.0), M(0.125)],
    ["gpt-5.1-codex-mini", M(0.25), M(2.0), M(0.025)],
    ["gpt-5", M(1.25), M(10.0), M(0.125)],
    ["gpt-5-codex", M(1.25), M(10.0), M(0.125)],
    ["gpt-5-mini", M(0.25), M(2.0), M(0.025)],
    ["gpt-5-fast", M(2.5), M(20.0), M(0.25)],
    ["gemini-3.1-pro", M(2.0), M(12.0), M(0.2)],
    ["gemini-3-pro", M(2.0), M(12.0), M(0.2)],
    ["gemini-3-flash", M(0.5), M(3.0), M(0.05)],
    ["gemini-3.5-flash", M(1.5), M(9.0), M(0.15)],
    ["gemini-2.5-flash", M(0.3), M(2.5), M(0.03)],
    ["grok-4.3", M(1.25), M(2.5), M(0.2)],
    ["grok-4.20", M(2.0), M(6.0), M(0.2)],
    ["grok-build-0.1", M(1.0), M(2.0), M(0.2)],
    ["kimi-k2.5", M(0.6), M(3.0), M(0.1)],
    ["glm-5.2", M(1.4), M(4.4), M(0.26)],
    ["composer-2", M(0.5), M(2.5), M(0.2)],
    ["composer-1.5", M(3.5), M(17.5), M(0.35)],
    ["composer-1", M(1.25), M(10.0), M(0.125)],
  ])("prices %s", (id, input, output, cached) => {
    expect(cursorModelRateMicros(id)).toEqual({
      inputPerMillionUsdMicros: input,
      outputPerMillionUsdMicros: output,
      cachedInputPerMillionUsdMicros: cached,
    });
  });

  it("strips a BYOK provider prefix before matching", () => {
    expect(cursorModelRateMicros("anthropic:claude-opus-4-8")).toEqual(
      cursorModelRateMicros("claude-opus-4-8"),
    );
    expect(cursorModelRateMicros("my-router:gpt-5-mini")).toEqual(
      cursorModelRateMicros("gpt-5-mini"),
    );
  });

  it("returns null for unknown / sentinel ids so cost stays unavailable, never estimated", () => {
    expect(cursorModelRateMicros("auto")).toBeNull();
    expect(cursorModelRateMicros("default")).toBeNull();
    expect(cursorModelRateMicros("totally-unknown-model")).toBeNull();
  });

  it("does not let the GPT-5 base rule shadow version- or tier-specific rules", () => {
    // Regression guard for rule ordering: nano/mini/fast and 5.x must win over /gpt-5/.
    expect(cursorModelRateMicros("gpt-5.4-nano")).not.toEqual(cursorModelRateMicros("gpt-5"));
    expect(cursorModelRateMicros("gpt-5.5")).not.toEqual(cursorModelRateMicros("gpt-5"));
    expect(cursorModelRateMicros("gpt-5-mini")).not.toEqual(cursorModelRateMicros("gpt-5"));
  });
});
