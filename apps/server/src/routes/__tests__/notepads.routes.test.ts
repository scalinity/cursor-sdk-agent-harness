import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { registerNotepadsRoutes } from "../notepads.routes.js";

function setup() {
  const db = openTestDb({ skipSeed: true });
  const repos = createRepositories(db.raw);
  const app = Fastify({ logger: false });
  return { db, repos, app };
}

describe("/api/notepads", () => {
  let cleanup: Array<() => Promise<void> | void> = [];

  beforeEach(() => {
    cleanup = [];
  });
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  it("lists notepads (empty initially)", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerNotepadsRoutes(app, { notepadsRepo: repos.notepads });

    const res = await app.inject({ method: "GET", url: "/api/notepads" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([]);
  });

  it("creates a notepad", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerNotepadsRoutes(app, { notepadsRepo: repos.notepads });

    const res = await app.inject({
      method: "POST",
      url: "/api/notepads",
      payload: { name: "Architecture Notes", content: "# Notes\nSome content" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.name).toBe("Architecture Notes");
    expect(body.content).toBe("# Notes\nSome content");
  });

  it("rejects duplicate notepad names", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerNotepadsRoutes(app, { notepadsRepo: repos.notepads });

    await app.inject({
      method: "POST",
      url: "/api/notepads",
      payload: { name: "Unique", content: "" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/notepads",
      payload: { name: "Unique", content: "" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects invalid notepad names", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerNotepadsRoutes(app, { notepadsRepo: repos.notepads });

    const res = await app.inject({
      method: "POST",
      url: "/api/notepads",
      payload: { name: "@invalid!", content: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("reads a notepad by id", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerNotepadsRoutes(app, { notepadsRepo: repos.notepads });

    const createRes = await app.inject({
      method: "POST",
      url: "/api/notepads",
      payload: { name: "Read Me", content: "Hello" },
    });
    const { id } = JSON.parse(createRes.payload);

    const res = await app.inject({ method: "GET", url: `/api/notepads/${id}` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).content).toBe("Hello");
  });

  it("updates notepad content", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerNotepadsRoutes(app, { notepadsRepo: repos.notepads });

    const createRes = await app.inject({
      method: "POST",
      url: "/api/notepads",
      payload: { name: "Update Me", content: "Old" },
    });
    const { id } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: "PUT",
      url: `/api/notepads/${id}`,
      payload: { content: "New content" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).content).toBe("New content");
  });

  it("renames a notepad", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerNotepadsRoutes(app, { notepadsRepo: repos.notepads });

    const createRes = await app.inject({
      method: "POST",
      url: "/api/notepads",
      payload: { name: "Old Name", content: "" },
    });
    const { id } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/notepads/${id}`,
      payload: { name: "New Name" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).name).toBe("New Name");
  });

  it("rejects renaming a notepad onto an existing name (409)", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerNotepadsRoutes(app, { notepadsRepo: repos.notepads });

    await app.inject({
      method: "POST",
      url: "/api/notepads",
      payload: { name: "Taken", content: "" },
    });
    const createRes = await app.inject({
      method: "POST",
      url: "/api/notepads",
      payload: { name: "Renamable", content: "" },
    });
    const { id } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/notepads/${id}`,
      payload: { name: "Taken" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("allows renaming a notepad to its own current name (no false collision)", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerNotepadsRoutes(app, { notepadsRepo: repos.notepads });

    const createRes = await app.inject({
      method: "POST",
      url: "/api/notepads",
      payload: { name: "Self Rename", content: "" },
    });
    const { id } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/notepads/${id}`,
      payload: { name: "Self Rename" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("deletes a notepad", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerNotepadsRoutes(app, { notepadsRepo: repos.notepads });

    const createRes = await app.inject({
      method: "POST",
      url: "/api/notepads",
      payload: { name: "Delete Me", content: "" },
    });
    const { id } = JSON.parse(createRes.payload);

    const res = await app.inject({ method: "DELETE", url: `/api/notepads/${id}` });
    expect(res.statusCode).toBe(204);
  });
});
