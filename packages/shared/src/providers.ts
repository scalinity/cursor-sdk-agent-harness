import { z } from "zod";
import { isoDateTimeSchema } from "./constants.js";

/**
 * Phase 23 — Multi-model provider contracts.
 *
 * The Cursor SDK only speaks Cursor's own models. To support BYOK with
 * Anthropic / OpenAI / Google / Ollama, the harness keeps a registry of
 * provider configs (keys in Keychain, never in the DB or on the wire) and
 * exposes a unified model list. Non-Cursor models are chat-only (Ask / Plan):
 * they have no tool-use infrastructure, so the model selector disables
 * Agent / YOLO modes for them.
 */

/** All provider kinds. `cursor` is the built-in default and is not user-added. */
export const providerKindSchema = z.enum([
  "cursor",
  "anthropic",
  "openai",
  "google",
  "ollama",
]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

/** Provider kinds a user can add via the API (cursor is implicit/built-in). */
export const addableProviderKindSchema = z.enum([
  "anthropic",
  "openai",
  "google",
  "ollama",
]);
export type AddableProviderKind = z.infer<typeof addableProviderKindSchema>;

/**
 * A configured provider as returned to the client. The API key is NEVER
 * included — only whether one is present (`hasApiKey`). Keys live in the
 * Keychain at account `provider:{id}:api-key`.
 */
export const modelProviderSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: providerKindSchema,
  baseUrl: z.string().nullable(),
  models: z.array(z.string()),
  enabled: z.boolean(),
  hasApiKey: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type ModelProviderSummary = z.infer<typeof modelProviderSummarySchema>;

export const listProvidersResponseSchema = z.object({
  items: z.array(modelProviderSummarySchema),
});
export type ListProvidersResponse = z.infer<typeof listProvidersResponseSchema>;

export const addProviderRequestSchema = z.object({
  name: z.string().min(1).max(100),
  provider: addableProviderKindSchema,
  apiKey: z.string().min(1).max(2000).optional(),
  baseUrl: z.string().url().optional(),
});
export type AddProviderRequest = z.infer<typeof addProviderRequestSchema>;

/** Result of `POST /api/providers/:id/test` — lists models on success. */
export const testProviderResponseSchema = z.object({
  ok: z.boolean(),
  models: z.array(z.string()),
  error: z.string().nullable(),
});
export type TestProviderResponse = z.infer<typeof testProviderResponseSchema>;

// ── Unified model list (GET /api/models) ───────────────────────────────────

export const modelCapabilitiesSchema = z.object({
  toolUse: z.boolean(), // true only for Cursor models in v1.2
  thinking: z.boolean(),
  vision: z.boolean(),
  streaming: z.boolean(),
});
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;

export const modelPricingHintSchema = z.object({
  inputPerMillionMicros: z.number(),
  outputPerMillionMicros: z.number(),
});
export type ModelPricingHint = z.infer<typeof modelPricingHintSchema>;

/**
 * One model across all providers. `id` is the unified model id used by
 * agents/runs: a bare Cursor enum id (e.g. `composer-2-5`) for Cursor, or
 * `{providerId}:{modelName}` for a BYOK provider. The sentinel `auto`
 * (see AUTO_MODEL_ID in models.ts) is surfaced separately, not in this list.
 */
export const unifiedModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: providerKindSchema,
  providerId: z.string(),
  capabilities: modelCapabilitiesSchema,
  pricing: modelPricingHintSchema.optional(),
});
export type UnifiedModel = z.infer<typeof unifiedModelSchema>;

export const listModelsResponseSchema = z.object({
  items: z.array(unifiedModelSchema),
  /** Whether the Auto sentinel is offered (always true — Cursor is built-in). */
  autoAvailable: z.boolean(),
});
export type ListModelsResponse = z.infer<typeof listModelsResponseSchema>;
