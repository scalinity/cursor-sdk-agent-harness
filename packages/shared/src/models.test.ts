import { describe, expect, it } from "vitest";
import {
  findEffortParameter,
  toHarnessModelId,
  toSdkModelId,
  type ModelParameterDefinition,
} from "./models.js";

function param(id: string, displayName?: string): ModelParameterDefinition {
  return {
    id,
    ...(displayName !== undefined ? { displayName } : {}),
    values: [{ value: "low" }, { value: "high" }],
  };
}

describe("findEffortParameter", () => {
  it("matches a parameter by id (thinking / reasoning / effort)", () => {
    for (const id of ["thinking", "reasoning", "reasoningEffort", "effort"]) {
      expect(findEffortParameter({ parameters: [param(id)] })?.id).toBe(id);
    }
  });

  it("matches by displayName when the id is opaque", () => {
    const p = param("p1", "Reasoning effort");
    expect(findEffortParameter({ parameters: [p] })?.id).toBe("p1");
  });

  it("returns null when no parameter looks like effort", () => {
    expect(findEffortParameter({ parameters: [param("verbosity")] })).toBeNull();
    expect(findEffortParameter({ parameters: [] })).toBeNull();
    expect(findEffortParameter({})).toBeNull();
  });

  it("does not treat an unrelated sole parameter as effort (no sole-param fallback)", () => {
    expect(findEffortParameter({ parameters: [param("temperature")] })).toBeNull();
  });

  it("picks the effort param out of a mixed set", () => {
    const models = { parameters: [param("verbosity"), param("thinking"), param("maxMode")] };
    expect(findEffortParameter(models)?.id).toBe("thinking");
  });
});

describe("model id reconciliation", () => {
  it("translates harness ids to SDK dotted ids and back", () => {
    expect(toSdkModelId("composer-2-5-fast")).toBe("composer-2.5");
    expect(toHarnessModelId("composer-2.5")).toBe("composer-2-5-fast");
  });

  it("maps both legacy composer ids to the single real SDK model (composer-2.5, not composer-2)", () => {
    expect(toSdkModelId("composer-2-5")).toBe("composer-2.5");
    expect(toSdkModelId("composer-2-5-fast")).toBe("composer-2.5");
    // The distinct older model keeps its own id.
    expect(toSdkModelId("composer-2")).toBe("composer-2");
    expect(toHarnessModelId("composer-2")).toBe("composer-2");
  });

  it("passes through ids with no alias (e.g. proxied frontier models)", () => {
    expect(toSdkModelId("claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(toHarnessModelId("claude-opus-4-8")).toBe("claude-opus-4-8");
  });
});
