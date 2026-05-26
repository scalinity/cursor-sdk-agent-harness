import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerTerminalAiRoutes, isDangerous } from "../terminal-ai.routes.js";

function setup() {
  const app = Fastify({ logger: false });
  return { app };
}

describe("/api/terminal/generate-command", () => {
  let cleanup: Array<() => Promise<void> | void> = [];

  beforeEach(() => {
    cleanup = [];
  });
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  it("generates a grep command for search queries", async () => {
    const { app } = setup();
    cleanup.push(() => app.close());
    await registerTerminalAiRoutes(app, {});

    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/generate-command",
      payload: {
        prompt: "search for TODO in the codebase",
        cwd: "/tmp/test",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.command).toContain("grep");
    expect(body.command).toContain("TODO");
    expect(body.dangerous).toBe(false);
  });

  it("shell-quotes generated grep and cat arguments", async () => {
    const { app } = setup();
    cleanup.push(() => app.close());
    await registerTerminalAiRoutes(app, {});

    const grep = await app.inject({
      method: "POST",
      url: "/api/terminal/generate-command",
      payload: {
        prompt: "search for TODO; rm -rf / in src/app.ts",
        cwd: "/tmp/test",
      },
    });
    const grepBody = JSON.parse(grep.payload);
    expect(grepBody.command).toBe("grep -rn -- 'TODO; rm -rf /' 'src/app.ts'");

    const cat = await app.inject({
      method: "POST",
      url: "/api/terminal/generate-command",
      payload: {
        prompt: "cat README.md; rm -rf /",
        cwd: "/tmp/test",
      },
    });
    const catBody = JSON.parse(cat.payload);
    expect(catBody.command).toBe("cat -- 'README.md; rm -rf /'");
  });

  it("generates a find command for file searches", async () => {
    const { app } = setup();
    cleanup.push(() => app.close());
    await registerTerminalAiRoutes(app, {});

    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/generate-command",
      payload: {
        prompt: "find all ts files larger than 100KB",
        cwd: "/tmp/test",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.command).toContain("find");
    expect(body.command).toContain("*.ts");
    expect(body.dangerous).toBe(false);
  });

  it("marks a generated disk-usage command as non-dangerous", async () => {
    const { app } = setup();
    cleanup.push(() => app.close());
    await registerTerminalAiRoutes(app, {});

    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/generate-command",
      payload: {
        prompt: "show disk usage",
        cwd: "/tmp/test",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.command).toContain("du");
    expect(body.dangerous).toBe(false);
  });

  it("returns a comment fallback for unrecognized prompts", async () => {
    const { app } = setup();
    cleanup.push(() => app.close());
    await registerTerminalAiRoutes(app, {});

    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/generate-command",
      payload: {
        prompt: "xyzzy plugh",
        cwd: "/tmp/test",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.command).toContain("#");
    expect(body.dangerous).toBe(false);
  });

  it("returns 400 for missing prompt", async () => {
    const { app } = setup();
    cleanup.push(() => app.close());
    await registerTerminalAiRoutes(app, {});

    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/generate-command",
      payload: { cwd: "/tmp/test" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("isDangerous", () => {
  it("flags destructive filesystem commands", () => {
    expect(isDangerous("rm -rf /")).toBe(true);
    expect(isDangerous("rm -r node_modules")).toBe(true);
    expect(isDangerous("rmdir /tmp/x")).toBe(true);
    expect(isDangerous("chmod 777 secrets")).toBe(true);
    expect(isDangerous("chown root file")).toBe(true);
    expect(isDangerous("mkfs.ext4 /dev/sda")).toBe(true);
    expect(isDangerous("dd if=/dev/zero of=/dev/sda")).toBe(true);
  });

  it("flags destructive process commands", () => {
    expect(isDangerous("kill 1234")).toBe(true);
    expect(isDangerous("killall node")).toBe(true);
    expect(isDangerous("pkill -9 node")).toBe(true);
  });

  it("flags destructive SQL", () => {
    expect(isDangerous("DROP TABLE users")).toBe(true);
    expect(isDangerous("DELETE FROM accounts")).toBe(true);
    expect(isDangerous("TRUNCATE logs")).toBe(true);
  });

  it("flags destructive git commands", () => {
    expect(isDangerous("git reset --hard HEAD~5")).toBe(true);
    expect(isDangerous("git clean -fd")).toBe(true);
    expect(isDangerous("git push --force origin main")).toBe(true);
    expect(isDangerous("git push -f")).toBe(true);
  });

  it("does not flag benign read commands", () => {
    expect(isDangerous("ls -la")).toBe(false);
    expect(isDangerous('grep -rn "TODO" .')).toBe(false);
    expect(isDangerous("du -sh * | sort -rh | head -20")).toBe(false);
    expect(isDangerous('find . -name "*.ts"')).toBe(false);
    expect(isDangerous("git status")).toBe(false);
  });

  it("does not flag the benign /dev/null redirect idiom", () => {
    expect(isDangerous("some-cmd 2>/dev/null")).toBe(false);
    expect(isDangerous("some-cmd > /dev/null 2>&1")).toBe(false);
  });

  it("flags redirecting output onto a raw block device", () => {
    expect(isDangerous("echo x > /dev/sda")).toBe(true);
    expect(isDangerous("cat img > /dev/disk2")).toBe(true);
    expect(isDangerous("foo >/dev/nvme0n1")).toBe(true);
  });
});
