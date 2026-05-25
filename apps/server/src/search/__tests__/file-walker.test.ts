import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  detectLanguage,
  loadIgnorePatterns,
  walkWorkspace,
} from "../file-walker.js";

describe("file-walker", () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-walk-"));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "harness-outside-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n");
    await fs.writeFile(path.join(root, "README.md"), "# hi\n");
    await fs.writeFile(path.join(root, "image.png"), "not indexed\n");
    await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "pkg", "x.ts"), "skip me\n");
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(path.join(root, "dist", "out.js"), "skip me\n");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("selects indexable extensions and skips node_modules/dist + binaries", async () => {
    const files = (await walkWorkspace(root)).map((f) => f.relPath);
    expect(files).toContain(path.join("src", "a.ts"));
    expect(files).toContain("README.md");
    expect(files).not.toContain("image.png"); // not an indexed extension
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
    expect(files.some((f) => f.includes("dist"))).toBe(false);
  });

  it("respects .gitignore patterns", async () => {
    await fs.writeFile(path.join(root, ".gitignore"), "src/a.ts\n");
    const patterns = await loadIgnorePatterns(root);
    const files = (await walkWorkspace(root, { ignorePatterns: patterns })).map((f) => f.relPath);
    expect(files).not.toContain(path.join("src", "a.ts"));
    expect(files).toContain("README.md");
  });

  it("skips files over the size cap and empty files", async () => {
    await fs.writeFile(path.join(root, "big.ts"), "x".repeat(200 * 1024));
    await fs.writeFile(path.join(root, "empty.ts"), "");
    const files = (await walkWorkspace(root)).map((f) => f.relPath);
    expect(files).not.toContain("big.ts");
    expect(files).not.toContain("empty.ts");
  });

  it("P23-C2: does NOT follow a symlinked directory pointing outside root", async () => {
    await fs.writeFile(path.join(outside, "secret.ts"), "export const SECRET = 1;\n");
    try {
      await fs.symlink(outside, path.join(root, "linkdir"), "dir");
    } catch {
      return; // symlink unsupported on this platform — skip
    }
    const files = (await walkWorkspace(root)).map((f) => f.relPath);
    expect(files.some((f) => f.includes("secret.ts"))).toBe(false);
    expect(files.some((f) => f.includes("linkdir"))).toBe(false);
  });

  it("P23-C2: does NOT index a symlinked file pointing outside root", async () => {
    await fs.writeFile(path.join(outside, "leak.ts"), "export const LEAK = 1;\n");
    try {
      await fs.symlink(path.join(outside, "leak.ts"), path.join(root, "leak.ts"), "file");
    } catch {
      return;
    }
    const files = (await walkWorkspace(root)).map((f) => f.relPath);
    expect(files).not.toContain("leak.ts");
  });

  it("detectLanguage maps extensions", () => {
    expect(detectLanguage("a.ts")).toBe("typescript");
    expect(detectLanguage("a.py")).toBe("python");
    expect(detectLanguage("a.unknown")).toBeNull();
  });
});
