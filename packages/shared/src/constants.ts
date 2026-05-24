import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const SCHEMA_VERSION = 1 as const;

export const LARGE_PAYLOAD_THRESHOLD_BYTES = 256 * 1024;

/**
 * Per-image base64 byte cap for run attachments (R17-W1). ~7 MB of base64 ≈
 * ~5 MiB decoded — generous for screenshots/diagrams while bounding the
 * in-memory cost of a `POST /api/runs` body. The server's Fastify `bodyLimit`
 * is sized from this × MAX_IMAGE_ATTACHMENTS. base64 inflates bytes ~33%.
 */
export const MAX_IMAGE_DATA_BYTES = 7_000_000;

export const isoDateTimeSchema = z.string().datetime();
export const frameIdSchema = z.string().min(8).max(128);
export const agentIdSchema = z.string().min(1).max(256);
export const runIdSchema = z.string().min(1).max(256);
export const eventIdSchema = z.string().uuid();
export const requestIdSchema = z.string().min(1).max(256);
export const callIdSchema = z.string().min(1).max(256);

export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;
export type FrameId = z.infer<typeof frameIdSchema>;
export type AgentId = z.infer<typeof agentIdSchema>;
export type RunId = z.infer<typeof runIdSchema>;
export type EventId = z.infer<typeof eventIdSchema>;
export type RequestId = z.infer<typeof requestIdSchema>;
export type CallId = z.infer<typeof callIdSchema>;
