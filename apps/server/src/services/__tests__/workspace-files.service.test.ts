import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  MAX_PREVIEW_BYTES,
} from "../workspace-files.service.js";

let root: string;
let outside: string;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "harness-wsfiles-")));
  outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "harness-outside-")));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "README.md"), "# hello\n");
  await fs.writeFile(path.join(root, "src", "index.ts"), 'export const X = 1;\n');
  await fs.writeFile(path.join(outside, "secret.txt"), "TOP SECRET\n");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe("listWorkspaceFiles", () => {
  it("lists the workspace root with directories before files", async () => {
    const result = await listWorkspaceFiles(root, "");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.relPath).toBe("");
    expect(result.value.parent).toBeNull();
    const names = result.value.entries.map((e) => e.name);
    expect(names).toContain("src");
    expect(names).toContain("README.md");
    // "src" (directory) must sort before "README.md" (file).
    expect(names.indexOf("src")).toBeLessThan(names.indexOf("README.md"));
    const dir = result.value.entries.find((e) => e.name === "src");
    expect(dir?.type).toBe("directory");
  });

  it("lists a subdirectory and reports the parent", async () => {
    const result = await listWorkspaceFiles(root, "src");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.relPath).toBe("src");
    expect(result.value.parent).toBe("");
    expect(result.value.entries.map((e) => e.name)).toEqual(["index.ts"]);
  });

  it("rejects a path that escapes the workspace via ..", async () => {
    const result = await listWorkspaceFiles(root, "../");
    expect(result).toEqual({ ok: false, code: "PATH_TRAVERSAL_REJECTED" });
  });

  it("rejects an absolute path", async () => {
    const result = await listWorkspaceFiles(root, outside);
    expect(result).toEqual({ ok: false, code: "ABSOLUTE_PATH_REJECTED" });
  });

  it("returns NOT_A_DIRECTORY when listing a file", async () => {
    const result = await listWorkspaceFiles(root, "README.md");
    expect(result).toEqual({ ok: false, code: "NOT_A_DIRECTORY" });
  });
});

describe("readWorkspaceFile", () => {
  it("reads UTF-8 text content", async () => {
    const result = await readWorkspaceFile(root, "src/index.ts");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe("export const X = 1;\n");
    expect(result.value.binary).toBe(false);
    expect(result.value.truncated).toBe(false);
  });

  it("flags binary files and returns empty content", async () => {
    await fs.writeFile(path.join(root, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff]));
    const result = await readWorkspaceFile(root, "blob.bin");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.binary).toBe(true);
    expect(result.value.content).toBe("");
  });

  it("truncates files larger than the preview cap", async () => {
    await fs.writeFile(path.join(root, "big.txt"), "a".repeat(MAX_PREVIEW_BYTES + 100));
    const result = await readWorkspaceFile(root, "big.txt");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.truncated).toBe(true);
    expect(result.value.content.length).toBe(MAX_PREVIEW_BYTES);
    expect(result.value.size).toBe(MAX_PREVIEW_BYTES + 100);
  });

  it("returns NOT_FOUND for a missing file", async () => {
    const result = await readWorkspaceFile(root, "does-not-exist.ts");
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("returns NOT_A_FILE when reading a directory", async () => {
    const result = await readWorkspaceFile(root, "src");
    expect(result).toEqual({ ok: false, code: "NOT_A_FILE" });
  });

  it("rejects reading through a symlink that escapes the workspace", async () => {
    // A symlink inside the workspace that points at an external directory must
    // not be a path to read files outside the workspace boundary.
    await fs.symlink(outside, path.join(root, "escape"));
    const result = await readWorkspaceFile(root, "escape/secret.txt");
    expect(result).toEqual({ ok: false, code: "PATH_TRAVERSAL_REJECTED" });
  });
});
