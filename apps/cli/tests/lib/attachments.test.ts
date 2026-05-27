import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachmentImages,
  expandHome,
  extractImageDropPaths,
  formatImageChipLabel,
  formatImageDropFailure,
  isImagePath,
  MAX_IMAGE_ATTACHMENTS,
  mergeImageAttachments,
  readImageFromPath,
  selectImageDropPaths,
  shouldTreatAsImageDrop,
  unwrapQuotedPath,
} from "../../src/lib/attachments.js";

describe("CLI attachments", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function writeTempPng(name = "shot.png"): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-cli-attach-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, name);
    await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    return filePath;
  }

  it("detects image extensions and quoted drop paths", () => {
    expect(isImagePath("/tmp/a.PNG")).toBe(true);
    expect(isImagePath("/tmp/readme.txt")).toBe(false);
    expect(unwrapQuotedPath(" '/Users/me/My Photo.png' ")).toBe("/Users/me/My Photo.png");
  });

  it("extracts single and multi-line image drop payloads", () => {
    expect(extractImageDropPaths("/Users/me/shot.png")).toEqual(["/Users/me/shot.png"]);
    expect(extractImageDropPaths("'/Users/me/a.png'\n'/Users/me/b.jpg'")).toEqual(["/Users/me/a.png", "/Users/me/b.jpg"]);
    expect(extractImageDropPaths("\x1b[200~/Users/me/shot.png\x1b[201~")).toEqual(["/Users/me/shot.png"]);
    expect(extractImageDropPaths("[200~/Users/me/shot.png\x1b[201~")).toEqual(["/Users/me/shot.png"]);
    expect(extractImageDropPaths("please inspect /Users/me/shot.png")).toBeNull();
    expect(extractImageDropPaths("/Users/me/readme.txt")).toBeNull();
    expect(extractImageDropPaths("a")).toBeNull();
    expect(extractImageDropPaths("photos/shot.png")).toEqual(["photos/shot.png"]);
  });

  it("only treats single-path paste as a drop when bracketed or the file exists", async () => {
    const filePath = await writeTempPng();
    expect(shouldTreatAsImageDrop("\x1b[200~" + filePath + "\x1b[201~", [filePath])).toBe(true);
    expect(shouldTreatAsImageDrop(filePath, [filePath])).toBe(true);
    expect(shouldTreatAsImageDrop("/tmp/missing-" + Date.now() + ".png", ["/tmp/missing-" + Date.now() + ".png"])).toBe(false);
    expect(shouldTreatAsImageDrop(`${filePath} ${filePath}`, [filePath, filePath])).toBe(true);
  });

  it("normalizes shell-escaped, URI, and multi-path drops", async () => {
    const filePath = await writeTempPng("My Image.png");
    const escaped = filePath.replace(/ /g, "\\ ");
    expect(extractImageDropPaths(escaped)).toEqual([filePath]);
    await expect(readImageFromPath(escaped)).resolves.toMatchObject({ name: "My Image.png" });

    const plain = await writeTempPng("plain.png");
    expect(extractImageDropPaths(`${plain} ${plain}`)).toEqual([plain, plain]);
    expect(extractImageDropPaths(`file://${plain}`)).toEqual([plain]);
    expect(extractImageDropPaths(`$'${filePath}'`)).toEqual([filePath]);
  });

  it("surfaces read failures with the underlying reason", () => {
    const message = formatImageDropFailure([
      { status: "rejected", reason: new Error("ENOENT: no such file or directory") },
    ]);
    expect(message).toContain("ENOENT");
    const multi = formatImageDropFailure([
      { status: "rejected", reason: new Error("too big") },
      { status: "rejected", reason: new Error("empty") },
    ]);
    expect(multi).toContain("too big");
    expect(multi).toContain("empty");
  });

  it("rejects empty and oversize images before loading", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-cli-empty-"));
    tempDirs.push(dir);
    const emptyPath = path.join(dir, "empty.png");
    await writeFile(emptyPath, Buffer.alloc(0));
    await expect(readImageFromPath(emptyPath)).rejects.toThrow(/empty/i);
  });

  it("rejects symlinked and mislabeled image files without leaking full paths", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-cli-attach-"));
    tempDirs.push(dir);
    const target = path.join(dir, "secret.png");
    const link = path.join(dir, "link.png");
    const fake = path.join(dir, "fake.png");
    await writeFile(target, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await symlink(target, link);
    await writeFile(fake, "not really a png");

    await expect(readImageFromPath(link)).rejects.toThrow(/symlink/i);
    await expect(readImageFromPath(fake)).rejects.toThrow(/does not match image\/png \(fake\.png\)/i);
    await expect(readImageFromPath(fake)).rejects.not.toThrow(dir);
  });

  it("rejects files whose bytes do not match the image extension", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-cli-mismatch-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "not-really.png");
    await writeFile(filePath, Buffer.from("not a png"));

    await expect(readImageFromPath(filePath)).rejects.toThrow(/does not match image\/png/i);
  });

  it("expands home paths and formats chip labels", () => {
    expect(expandHome("~")).toBe(os.homedir());
    expect(formatImageChipLabel("short.png")).toBe("short.png");
    expect(formatImageChipLabel("a-very-long-screenshot-name.png", 12)).toBe("a-very-long…");
  });

  it("reads an image file from disk into SdkImage form", async () => {
    const filePath = await writeTempPng();
    const attachment = await readImageFromPath(filePath);
    expect(attachment.name).toBe("shot.png");
    expect(attachment.image.mimeType).toBe("image/png");
    expect(attachmentImages([attachment])).toEqual([attachment.image]);
  });

  it("deduplicates and caps dropped paths before reading files", () => {
    const paths = Array.from({ length: MAX_IMAGE_ATTACHMENTS + 4 }, (_, index) => `/tmp/${index}.png`);
    const result = selectImageDropPaths([paths[0]!, paths[0]!, ...paths], 2);

    expect(result.selected).toHaveLength(MAX_IMAGE_ATTACHMENTS - 2);
    expect(result.selected[0]).toBe(paths[0]);
    expect(result.skippedCount).toBe(6);
  });

  it("caps merged attachments at the shared max", () => {
    const make = (index: number) => ({
      id: String(index),
      name: `${index}.png`,
      image: { data: "aGVsbG8=", mimeType: "image/png" as const },
    });
    const merged = mergeImageAttachments([], Array.from({ length: 20 }, (_, index) => make(index)));
    expect(merged).toHaveLength(16);
  });
});
