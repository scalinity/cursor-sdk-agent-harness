import type { FastifyInstance } from "fastify";
import {
  createSlashCommandRequestSchema,
  updateSlashCommandRequestSchema,
  expandCommandRequestSchema,
} from "@harness/shared";
import type { SlashCommandsRepo } from "../db/repositories/slash-commands.repo.js";

export interface CommandsRoutesDeps {
  slashCommandsRepo: SlashCommandsRepo;
}

export async function registerCommandsRoutes(
  app: FastifyInstance,
  deps: CommandsRoutesDeps,
): Promise<void> {
  app.get("/api/commands", async (_request, reply) => {
    const commands = deps.slashCommandsRepo.list();
    return reply.send(commands);
  });

  app.post("/api/commands", async (request, reply) => {
    const parsed = createSlashCommandRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ code: "VALIDATION_ERROR", message: parsed.error.message });
    }

    const existing = deps.slashCommandsRepo.getByName(parsed.data.name);
    if (existing) {
      return reply
        .code(409)
        .send({
          code: "DUPLICATE_NAME",
          message: `Command "/${parsed.data.name}" already exists`,
        });
    }

    const id = crypto.randomUUID();
    const command = deps.slashCommandsRepo.create(
      id,
      parsed.data.name,
      parsed.data.description,
      parsed.data.template,
    );
    return reply.code(201).send(command);
  });

  app.put<{ Params: { id: string } }>(
    "/api/commands/:id",
    async (request, reply) => {
      const parsed = updateSlashCommandRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ code: "VALIDATION_ERROR", message: parsed.error.message });
      }

      if (parsed.data.name) {
        const existing = deps.slashCommandsRepo.getByName(parsed.data.name);
        if (existing && existing.id !== request.params.id) {
          return reply.code(409).send({
            code: "DUPLICATE_NAME",
            message: `Command "/${parsed.data.name}" already exists`,
          });
        }
      }

      const updated = deps.slashCommandsRepo.update(
        request.params.id,
        parsed.data,
      );
      if (!updated) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Command not found" });
      }

      const command = deps.slashCommandsRepo.getById(request.params.id);
      return reply.send(command);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/commands/:id",
    async (request, reply) => {
      const deleted = deps.slashCommandsRepo.delete(request.params.id);
      if (!deleted) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Command not found" });
      }
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/commands/:id/expand",
    async (request, reply) => {
      const parsed = expandCommandRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ code: "VALIDATION_ERROR", message: parsed.error.message });
      }

      const command = deps.slashCommandsRepo.getById(request.params.id);
      if (!command) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Command not found" });
      }

      let expandedText = command.template;
      for (const [key, value] of Object.entries(parsed.data.variables)) {
        expandedText = expandedText.replaceAll(`{{${key}}}`, value);
      }

      return reply.send({ expandedText });
    },
  );
}
