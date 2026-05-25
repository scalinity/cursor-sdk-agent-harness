import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { registerCommandsRoutes } from "../commands.routes.js";

function setup() {
  const db = openTestDb({ skipSeed: true });
  const repos = createRepositories(db.raw);
  const app = Fastify({ logger: false });
  return { db, repos, app };
}

describe("/api/commands", () => {
  let cleanup: Array<() => Promise<void> | void> = [];

  beforeEach(() => {
    cleanup = [];
  });
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  it("lists commands (empty initially)", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerCommandsRoutes(app, { slashCommandsRepo: repos.slashCommands });

    const res = await app.inject({ method: "GET", url: "/api/commands" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([]);
  });

  it("creates a slash command", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerCommandsRoutes(app, { slashCommandsRepo: repos.slashCommands });

    const res = await app.inject({
      method: "POST",
      url: "/api/commands",
      payload: {
        name: "test-cmd",
        description: "A test command",
        template: "Do {{action}} with {{target}}",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.name).toBe("test-cmd");
    expect(body.template).toContain("{{action}}");
  });

  it("rejects duplicate command names", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerCommandsRoutes(app, { slashCommandsRepo: repos.slashCommands });

    await app.inject({
      method: "POST",
      url: "/api/commands",
      payload: { name: "dupe", description: "First", template: "First template" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/commands",
      payload: { name: "dupe", description: "Second", template: "Second template" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects invalid command names", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerCommandsRoutes(app, { slashCommandsRepo: repos.slashCommands });

    const res = await app.inject({
      method: "POST",
      url: "/api/commands",
      payload: { name: "Invalid Name!", description: "Bad", template: "Template" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("updates a command", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerCommandsRoutes(app, { slashCommandsRepo: repos.slashCommands });

    const createRes = await app.inject({
      method: "POST",
      url: "/api/commands",
      payload: { name: "updatable", description: "Old", template: "Old template" },
    });
    const { id } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: "PUT",
      url: `/api/commands/${id}`,
      payload: { description: "New description" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).description).toBe("New description");
  });

  it("deletes a command", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerCommandsRoutes(app, { slashCommandsRepo: repos.slashCommands });

    const createRes = await app.inject({
      method: "POST",
      url: "/api/commands",
      payload: { name: "deletable", description: "Bye", template: "Template" },
    });
    const { id } = JSON.parse(createRes.payload);

    const res = await app.inject({ method: "DELETE", url: `/api/commands/${id}` });
    expect(res.statusCode).toBe(204);
  });

  it("expands a template with variables", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerCommandsRoutes(app, { slashCommandsRepo: repos.slashCommands });

    const createRes = await app.inject({
      method: "POST",
      url: "/api/commands",
      payload: {
        name: "greet",
        description: "Greet someone",
        template: "Hello {{name}}, welcome to {{place}}!",
      },
    });
    const { id } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: "POST",
      url: `/api/commands/${id}/expand`,
      payload: { variables: { name: "Alice", place: "Wonderland" } },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.expandedText).toBe("Hello Alice, welcome to Wonderland!");
  });

  it("seeds built-in commands", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());

    const seeded = repos.slashCommands.seedBuiltins();
    expect(seeded).toBe(5);

    await registerCommandsRoutes(app, { slashCommandsRepo: repos.slashCommands });
    const res = await app.inject({ method: "GET", url: "/api/commands" });
    const commands = JSON.parse(res.payload);
    const names = commands.map((c: { name: string }) => c.name);
    expect(names).toContain("explain");
    expect(names).toContain("review");
    expect(names).toContain("test");
    expect(names).toContain("fix");
    expect(names).toContain("refactor");
  });

  it("does not re-seed existing commands", async () => {
    const { db, repos } = setup();
    cleanup.push(() => db.close());

    repos.slashCommands.seedBuiltins();
    const second = repos.slashCommands.seedBuiltins();
    expect(second).toBe(0);
  });
});
