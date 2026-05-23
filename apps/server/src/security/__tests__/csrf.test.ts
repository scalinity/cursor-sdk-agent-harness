import { describe, expect, it } from "vitest";
import { CsrfTokenizer } from "../csrf.js";

describe("CsrfTokenizer", () => {
  const secret = "a".repeat(32);

  it("validates a freshly issued token", () => {
    const t = new CsrfTokenizer(secret);
    const token = t.issue();
    expect(t.validate(token)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const t = new CsrfTokenizer(secret);
    const token = t.issue();
    const parts = token.split(".");
    const sigBuf = Buffer.from(parts[2]!, "base64url");
    sigBuf[0] = sigBuf[0]! ^ 0xff;
    const tampered = [parts[0], parts[1], sigBuf.toString("base64url")].join(".");
    expect(t.validate(tampered)).toBe(false);
  });

  it("rejects an expired token", () => {
    const t = new CsrfTokenizer(secret);
    const past = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const token = t.issue(past);
    expect(t.validate(token)).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const a = new CsrfTokenizer("a".repeat(32));
    const b = new CsrfTokenizer("b".repeat(32));
    expect(b.validate(a.issue())).toBe(false);
  });

  it("rejects malformed tokens", () => {
    const t = new CsrfTokenizer(secret);
    expect(t.validate("")).toBe(false);
    expect(t.validate("not.a.valid.token.shape")).toBe(false);
    expect(t.validate("only-one-part")).toBe(false);
    expect(t.validate("a.b")).toBe(false);
  });

  it("refuses to construct with a too-short secret", () => {
    expect(() => new CsrfTokenizer("short")).toThrow(/too short/);
  });
});
