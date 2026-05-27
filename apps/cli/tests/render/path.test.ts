import { describe, expect, it } from "vitest";
import { normalizePath } from "../../src/render/path.js";

const cwd = "/home/u/proj";
const home = "/home/u";

describe("normalizePath", () => {
  it("renders paths inside cwd as relative", () => {
    expect(normalizePath("/home/u/proj/src/index.ts", cwd, { home })).toBe("src/index.ts");
    expect(normalizePath("/home/u/proj", cwd, { home })).toBe(".");
  });

  it("renders paths inside $HOME but outside cwd with a tilde", () => {
    expect(normalizePath("/home/u/other/file.ts", cwd, { home })).toBe("~/other/file.ts");
    expect(normalizePath("/home/u", cwd, { home })).toBe("~");
    // Sibling prefix must not be mistaken for being inside cwd.
    expect(normalizePath("/home/u/proj2/x.ts", cwd, { home })).toBe("~/proj2/x.ts");
  });

  it("leaves paths outside cwd and $HOME absolute", () => {
    expect(normalizePath("/usr/local/bin/node", cwd, { home })).toBe("/usr/local/bin/node");
  });

  it("expands a leading tilde against $HOME", () => {
    expect(normalizePath("~/notes.md", cwd, { home })).toBe("~/notes.md");
    expect(normalizePath("~/proj/src/a.ts", cwd, { home })).toBe("src/a.ts");
  });

  it("leaves a ~user (no-slash) home reference untouched", () => {
    expect(normalizePath("~bob", cwd, { home })).toBe("~bob");
    expect(normalizePath("~bob/notes.md", cwd, { home })).toBe("~bob/notes.md");
  });

  it("treats already-relative input as cwd-relative and leaves it untouched", () => {
    expect(normalizePath("src/already.ts", cwd, { home })).toBe("src/already.ts");
  });

  it("middle-truncates (never right-truncates) when maxWidth is set", () => {
    const out = normalizePath("/usr/local/some/very/long/path/bin/node", cwd, { home, maxWidth: 20 });
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out).toContain("…");
    // Middle-truncation keeps the basename visible (right-truncation would drop it).
    expect(out.endsWith("node")).toBe(true);
  });

  it("returns empty input unchanged", () => {
    expect(normalizePath("", cwd, { home })).toBe("");
  });
});
