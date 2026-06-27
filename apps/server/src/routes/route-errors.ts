import type { FastifyReply } from "fastify";
import type { z } from "zod";
import type { AgentRuntimeError } from "../sdk/index.js";

/**
 * Shared HTTP error responders for the route layer. These were previously
 * copy-pasted verbatim across many route modules; centralizing them keeps the
 * status-code → error-code mapping in one place so the REST contract can't
 * drift between routes.
 */

/** 422 response for a request body/query that failed Zod validation. */
export function send422(reply: FastifyReply, error: z.ZodError): FastifyReply {
  return reply.code(422).send({
    code: "VALIDATION_ERROR",
    details: error.issues,
  });
}

/** Map an {@link AgentRuntimeError} to its conventional HTTP status. */
export function sendRuntimeError(reply: FastifyReply, err: AgentRuntimeError): FastifyReply {
  switch (err.code) {
    case "MISSING_API_KEY":
      return reply.code(412).send({ code: err.code, message: err.message });
    case "AGENT_NOT_FOUND":
    case "RUN_NOT_FOUND":
      return reply.code(404).send({ code: err.code, message: err.message });
    case "AGENT_TERMINATED":
      return reply.code(409).send({ code: err.code, message: err.message });
    case "AGENT_BUSY":
      return reply.code(409).send({ code: err.code, message: err.message });
    case "SDK_CREATE_FAILED":
    case "SDK_RESUME_FAILED":
    case "SDK_SEND_FAILED":
      return reply.code(502).send({ code: err.code, message: err.message });
    case "MCP_SECRET_MISSING":
      return reply.code(503).send({ code: err.code, message: err.message, details: err.details });
    default: {
      const _exhaustive: never = err.code;
      void _exhaustive;
      return reply.code(500).send({ code: "INTERNAL", message: err.message });
    }
  }
}
