import type { FastifyInstance } from "fastify";
import {
  eventLargePayloadResponseSchema,
  eventPayloadResponseSchema,
  largePayloadFieldSchema,
} from "@harness/shared";
import type { EventsRepo } from "../db/repositories/events.repo.js";

export interface EventsRoutesDeps {
  events: EventsRepo;
}

export async function registerEventsRoutes(
  app: FastifyInstance,
  deps: EventsRoutesDeps,
): Promise<void> {
  app.get<{ Params: { eventId: string } }>("/api/events/:eventId/payload", async (req, reply) => {
    const row = deps.events.getPayloadById(req.params.eventId);
    if (!row) return reply.code(404).send({ code: "EVENT_NOT_FOUND" });
    return eventPayloadResponseSchema.parse({ value: row.value });
  });

  app.get<{ Params: { eventId: string; field: string } }>(
    "/api/events/:eventId/large-payload/:field",
    async (req, reply) => {
      const field = largePayloadFieldSchema.safeParse(req.params.field);
      if (!field.success) return reply.code(404).send({ code: "LARGE_PAYLOAD_FIELD_NOT_FOUND" });

      const row = deps.events.getLargePayloadField(req.params.eventId, field.data);
      if (!row) return reply.code(404).send({ code: "LARGE_PAYLOAD_NOT_FOUND" });
      return eventLargePayloadResponseSchema.parse({ value: row.value, byteCount: row.byteCount });
    },
  );
}
