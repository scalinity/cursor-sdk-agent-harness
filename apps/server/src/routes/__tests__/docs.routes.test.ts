import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { registerDocsRoutes } from "../docs.routes.js";

function setup() {
  const db = openTestDb({ skipSeed: true });
  const repos = createRepositories(db.raw);
  const app = Fastify({ logger: false });
  return { db, repos, app };
}

describe("/api/docs/sources", () => {
  let cleanup: Array<() => Promise<void> | void> = [];

  beforeEach(() => {
    cleanup = [];
  });
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  it("lists sources (empty initially)", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerDocsRoutes(app, { docsRepo: repos.docs });

    const res = await app.inject({ method: "GET", url: "/api/docs/sources" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([]);
  });

  it("creates a new docs source", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerDocsRoutes(app, { docsRepo: repos.docs });

    const res = await app.inject({
      method: "POST",
      url: "/api/docs/sources",
      payload: { name: "Test Docs", baseUrl: "https://example.com/docs" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.name).toBe("Test Docs");
    expect(body.baseUrl).toBe("https://example.com/docs");
    expect(body.status).toBe("pending");
  });

  it("deletes a docs source", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerDocsRoutes(app, { docsRepo: repos.docs });

    const createRes = await app.inject({
      method: "POST",
      url: "/api/docs/sources",
      payload: { name: "To Delete", baseUrl: "https://example.com" },
    });
    const { id } = JSON.parse(createRes.payload);

    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/docs/sources/${id}`,
    });
    expect(delRes.statusCode).toBe(204);

    const listRes = await app.inject({ method: "GET", url: "/api/docs/sources" });
    expect(JSON.parse(listRes.payload)).toEqual([]);
  });

  it("returns 404 for deleting non-existent source", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerDocsRoutes(app, { docsRepo: repos.docs });

    const res = await app.inject({
      method: "DELETE",
      url: "/api/docs/sources/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });

  it("removes FTS rows when a source is deleted (no orphans)", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerDocsRoutes(app, { docsRepo: repos.docs });

    const sourceId = crypto.randomUUID();
    repos.docs.insertSource(sourceId, "Orphan Test", "https://example.com", 100);
    repos.docs.insertPage(
      crypto.randomUUID(),
      sourceId,
      "https://example.com/p",
      "Page",
      "orphan candidate content for fts",
    );

    const ftsBefore = (
      db.raw.prepare("SELECT COUNT(*) AS c FROM docs_fts").get() as { c: number }
    ).c;
    expect(ftsBefore).toBe(1);

    repos.docs.deleteSource(sourceId);

    const ftsAfter = (
      db.raw.prepare("SELECT COUNT(*) AS c FROM docs_fts").get() as { c: number }
    ).c;
    expect(ftsAfter).toBe(0);
  });
});

describe("/api/docs/search", () => {
  let cleanup: Array<() => Promise<void> | void> = [];

  beforeEach(() => {
    cleanup = [];
  });
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  it("searches indexed pages", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerDocsRoutes(app, { docsRepo: repos.docs });

    const sourceId = crypto.randomUUID();
    repos.docs.insertSource(sourceId, "Test", "https://example.com", 100);
    repos.docs.updateSourceStatus(sourceId, "indexed");
    repos.docs.insertPage(
      crypto.randomUUID(),
      sourceId,
      "https://example.com/guide",
      "Getting Started Guide",
      "This is a comprehensive guide to getting started with the framework. It covers installation, setup, and basic usage.",
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/docs/search?q=comprehensive",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].title).toBe("Getting Started Guide");
  });

  it("returns 400 for missing query", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerDocsRoutes(app, { docsRepo: repos.docs });

    const res = await app.inject({ method: "GET", url: "/api/docs/search" });
    expect(res.statusCode).toBe(400);
  });

  it("does not 500 on FTS-operator characters in the query", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerDocsRoutes(app, { docsRepo: repos.docs });

    const sourceId = crypto.randomUUID();
    repos.docs.insertSource(sourceId, "Test", "https://example.com", 100);
    repos.docs.insertPage(
      crypto.randomUUID(),
      sourceId,
      "https://example.com/g",
      "Error handling guide",
      "A guide about error-handling and the c++ operator in React.useState()",
    );

    // Each of these would throw SqliteError if passed raw to FTS5 MATCH.
    for (const q of ["error-handling", "c++", "React.useState()", "hello OR", 'a "quote', "NEAR(x", "a:b"]) {
      const res = await app.inject({
        method: "GET",
        url: `/api/docs/search?q=${encodeURIComponent(q)}`,
      });
      expect(res.statusCode, `query: ${q}`).toBe(200);
    }
  });
});
