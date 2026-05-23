import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const SCHEMA_VERSION = 1 as const;

export const LARGE_PAYLOAD_THRESHOLD_BYTES = 256 * 1024;

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
