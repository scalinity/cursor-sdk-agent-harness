// Run with: node --test scripts/__tests__/parse-dotenv.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDotEnv, applyDotEnvToProcess } from "../lib/parse-dotenv.mjs";

describe("parseDotEnv", () => {
  it("parses KEY=value lines", () => {
    const out = parseDotEnv("HOST=127.0.0.1\nPORT=4783");
    assert.equal(out.HOST, "127.0.0.1");
    assert.equal(out.PORT, "4783");
  });

  it("strips double-quoted values", () => {
    const out = parseDotEnv('CURSOR_API_KEY="crsr_abc123"');
    assert.equal(out.CURSOR_API_KEY, "crsr_abc123");
  });

  it("strips single-quoted values", () => {
    const out = parseDotEnv("FOO='bar baz'");
    assert.equal(out.FOO, "bar baz");
  });

  it("ignores comment lines and blank lines", () => {
    const raw = ["# top comment", "", "  ", "KEY=value", "# trailing comment", ""].join("\n");
    const out = parseDotEnv(raw);
    assert.deepEqual(Object.keys(out), ["KEY"]);
    assert.equal(out.KEY, "value");
  });

  it("ignores lines without =", () => {
    const out = parseDotEnv("noequals\nKEY=value");
    assert.deepEqual(Object.keys(out), ["KEY"]);
  });

  it("ignores lines with empty key", () => {
    const out = parseDotEnv("=orphan\nKEY=value");
    assert.deepEqual(Object.keys(out), ["KEY"]);
  });

  it("trims whitespace around key and value", () => {
    const out = parseDotEnv("  SPACED  =  trimmed  ");
    assert.equal(out.SPACED, "trimmed");
  });

  it("preserves '=' characters inside values", () => {
    const out = parseDotEnv("DSN=postgres://user:pass=hard@host/db");
    assert.equal(out.DSN, "postgres://user:pass=hard@host/db");
  });

  it("returns a null-prototype object (no Object.prototype pollution)", () => {
    const out = parseDotEnv("toString=injected");
    assert.equal(out.toString, "injected");
    // null-prototype object: Object.prototype.toString is not inherited
    assert.equal(Object.getPrototypeOf(out), null);
  });
});

describe("applyDotEnvToProcess", () => {
  it("sets keys that are not already in env", () => {
    const env = { EXISTING: "keep" };
    applyDotEnvToProcess({ NEW_KEY: "added", EXISTING: "would-overwrite" }, env);
    assert.equal(env.NEW_KEY, "added");
    assert.equal(env.EXISTING, "keep");
  });

  it("never overwrites existing env (matches dotenv default)", () => {
    const env = { CURSOR_API_KEY: "from-shell" };
    applyDotEnvToProcess({ CURSOR_API_KEY: "from-dotenv" }, env);
    assert.equal(env.CURSOR_API_KEY, "from-shell");
  });
});
