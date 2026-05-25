import type { FastifyInstance } from "fastify";
import {
  createNotepadRequestSchema,
  updateNotepadContentRequestSchema,
  renameNotepadRequestSchema,
} from "@harness/shared";
import type { NotepadsRepo } from "../db/repositories/notepads.repo.js";

export interface NotepadsRoutesDeps {
  notepadsRepo: NotepadsRepo;
}

export async function registerNotepadsRoutes(
  app: FastifyInstance,
  deps: NotepadsRoutesDeps,
): Promise<void> {
  app.get("/api/notepads", async (_request, reply) => {
    const list = deps.notepadsRepo.list();
    return reply.send(list);
  });

  app.post("/api/notepads", async (request, reply) => {
    const parsed = createNotepadRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ code: "VALIDATION_ERROR", message: parsed.error.message });
    }

    const existing = deps.notepadsRepo.getByName(parsed.data.name);
    if (existing) {
      return reply
        .code(409)
        .send({ code: "DUPLICATE_NAME", message: `Notepad "${parsed.data.name}" already exists` });
    }

    const id = crypto.randomUUID();
    const notepad = deps.notepadsRepo.create(
      id,
      parsed.data.name,
      parsed.data.content,
    );
    return reply.code(201).send(notepad);
  });

  app.get<{ Params: { id: string } }>(
    "/api/notepads/:id",
    async (request, reply) => {
      const notepad = deps.notepadsRepo.getById(request.params.id);
      if (!notepad) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Notepad not found" });
      }
      return reply.send(notepad);
    },
  );

  app.put<{ Params: { id: string } }>(
    "/api/notepads/:id",
    async (request, reply) => {
      const parsed = updateNotepadContentRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ code: "VALIDATION_ERROR", message: parsed.error.message });
      }

      const updated = deps.notepadsRepo.updateContent(
        request.params.id,
        parsed.data.content,
      );
      if (!updated) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Notepad not found" });
      }

      const notepad = deps.notepadsRepo.getById(request.params.id);
      return reply.send(notepad);
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/notepads/:id",
    async (request, reply) => {
      const parsed = renameNotepadRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ code: "VALIDATION_ERROR", message: parsed.error.message });
      }

      const existing = deps.notepadsRepo.getByName(parsed.data.name);
      if (existing && existing.id !== request.params.id) {
        return reply
          .code(409)
          .send({ code: "DUPLICATE_NAME", message: `Notepad "${parsed.data.name}" already exists` });
      }

      const renamed = deps.notepadsRepo.rename(
        request.params.id,
        parsed.data.name,
      );
      if (!renamed) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Notepad not found" });
      }

      const notepad = deps.notepadsRepo.getById(request.params.id);
      return reply.send(notepad);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/notepads/:id",
    async (request, reply) => {
      const deleted = deps.notepadsRepo.delete(request.params.id);
      if (!deleted) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Notepad not found" });
      }
      return reply.code(204).send();
    },
  );
}
