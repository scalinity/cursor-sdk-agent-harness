import { describe, expect, it } from "vitest";
import {
  BindPolicyError,
  assertBindAllowed,
  checkBind,
  isLoopback,
} from "../bind-policy.js";

describe("bind-policy", () => {
  it("treats 127.0.0.1, localhost, ::1 as loopback", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("localhost")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("0.0.0.0")).toBe(false);
    expect(isLoopback("192.168.1.10")).toBe(false);
  });

  it("checkBind allows loopback regardless of allowRemote", () => {
    expect(checkBind("127.0.0.1", false).ok).toBe(true);
    expect(checkBind("127.0.0.1", true).ok).toBe(true);
  });

  it("checkBind refuses non-loopback without allowRemote", () => {
    const r = checkBind("0.0.0.0", false);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ALLOW_REMOTE_BIND/);
  });

  it("checkBind allows non-loopback when allowRemote is true", () => {
    expect(checkBind("0.0.0.0", true).ok).toBe(true);
  });

  it("assertBindAllowed throws BindPolicyError on rejection", () => {
    expect(() => assertBindAllowed("0.0.0.0", false)).toThrow(BindPolicyError);
    expect(() => assertBindAllowed("127.0.0.1", false)).not.toThrow();
  });
});
