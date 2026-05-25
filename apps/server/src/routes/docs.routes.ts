import type { FastifyInstance } from "fastify";
import { addDocsSourceRequestSchema, docsSearchQuerySchema } from "@harness/shared";
import type { DocsRepo } from "../db/repositories/docs.repo.js";
import { crawlDocumentation } from "../services/docs-crawler.service.js";

export interface DocsRoutesDeps {
  docsRepo: DocsRepo;
}

export async function registerDocsRoutes(
  app: FastifyInstance,
  deps: DocsRoutesDeps,
): Promise<void> {
  app.get("/api/docs/sources", async (_request, reply) => {
    const sources = deps.docsRepo.listSources();
    return reply.send(sources);
  });

  app.post("/api/docs/sources", async (request, reply) => {
    const parsed = addDocsSourceRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ code: "VALIDATION_ERROR", message: parsed.error.message });
    }

    const id = crypto.randomUUID();
    const source = deps.docsRepo.insertSource(
      id,
      parsed.data.name,
      parsed.data.baseUrl,
      parsed.data.maxPages,
    );

    crawlDocumentation(
      id,
      parsed.data.baseUrl,
      parsed.data.maxPages,
      deps.docsRepo,
    ).catch((err) => {
      app.log.error({ err, sourceId: id }, "Background crawl failed");
    });

    return reply.code(201).send(source);
  });

  app.delete<{ Params: { id: string } }>(
    "/api/docs/sources/:id",
    async (request, reply) => {
      const deleted = deps.docsRepo.deleteSource(request.params.id);
      if (!deleted) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Docs source not found" });
      }
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/docs/sources/:id/recrawl",
    async (request, reply) => {
      const source = deps.docsRepo.getSource(request.params.id);
      if (!source) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Docs source not found" });
      }

      deps.docsRepo.deletePagesBySource(source.id);
      deps.docsRepo.updateSourcePageCount(source.id, 0);

      crawlDocumentation(
        source.id,
        source.baseUrl,
        source.maxPages,
        deps.docsRepo,
      ).catch((err) => {
        app.log.error({ err, sourceId: source.id }, "Background recrawl failed");
      });

      return reply.send({ status: "recrawling" });
    },
  );

  app.get("/api/docs/search", async (request, reply) => {
    const parsed = docsSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ code: "VALIDATION_ERROR", message: parsed.error.message });
    }

    const results = deps.docsRepo.search(
      parsed.data.q,
      parsed.data.maxResults,
      parsed.data.sourceId,
    );

    return reply.send({ results });
  });
}
