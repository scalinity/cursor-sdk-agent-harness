// Run with: node --test scripts/__tests__/review-debate-hook.test.mjs
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

function runHook(args) {
  return spawnSync(process.execPath, ["scripts/review-debate-hook.mjs", ...args], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
  });
}

describe("review-debate-hook", () => {
  it("prints the reviewer, Codex, and handoff sections", () => {
    const result = runHook(["--reviewer", "Looks good", "--codex", "Consider edge cases"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /## Review Debate/);
    assert.match(result.stdout, /### Reviewer position\nLooks good/);
    assert.match(result.stdout, /### Codex position\nConsider edge cases/);
    assert.match(result.stdout, /<@U0B6G38BPNV> you have the mic/);
  });

  it("does not consume the next flag as a missing argument value", () => {
    const result = runHook(["--reviewer", "--codex", "Counterpoint"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /### Reviewer position\n\(reviewer notes pending\)/);
    assert.match(result.stdout, /### Codex position\nCounterpoint/);
  });
});
