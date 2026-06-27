import {
  apiKeyPresenceResponseSchema,
  setApiKeyRequestSchema,
  settingsSnapshotSchema,
  updatePricingRequestSchema,
  updateSettingsRequestSchema,
} from "@harness/shared";
import type { FastifyInstance } from "fastify";
import type { CursorApiKeyStore } from "../keychain/cursor-api-key.js";
import type { SettingsRepo } from "../db/repositories/settings.repo.js";
import {
  applyPricingUpdate,
  applySettingsUpdate,
  getSettingsSnapshot,
} from "../services/settings.service.js";
import { send422 } from "./route-errors.js";

export interface SettingsRoutesDeps {
  settings: SettingsRepo;
  apiKeyStore: CursorApiKeyStore;
}

export async function registerSettingsRoutes(
  app: FastifyInstance,
  deps: SettingsRoutesDeps,
): Promise<void> {
  app.get("/api/settings", async () => {
    const snapshot = getSettingsSnapshot(deps.settings);
    return settingsSnapshotSchema.parse(snapshot);
  });

  app.patch("/api/settings", async (req, reply) => {
    const parsed = updateSettingsRequestSchema.safeParse(req.body);
    if (!parsed.success) return send422(reply, parsed.error);
    const snapshot = applySettingsUpdate(deps.settings, parsed.data);
    return settingsSnapshotSchema.parse(snapshot);
  });

  app.patch("/api/settings/pricing", async (req, reply) => {
    const parsed = updatePricingRequestSchema.safeParse(req.body);
    if (!parsed.success) return send422(reply, parsed.error);
    const snapshot = applyPricingUpdate(deps.settings, parsed.data);
    return settingsSnapshotSchema.parse(snapshot);
  });

  app.get("/api/settings/api-key", async () => {
    const present = await deps.apiKeyStore.hasApiKey();
    return apiKeyPresenceResponseSchema.parse({ present });
  });

  app.put("/api/settings/api-key", async (req, reply) => {
    const parsed = setApiKeyRequestSchema.safeParse(req.body);
    if (!parsed.success) return send422(reply, parsed.error);
    await deps.apiKeyStore.setApiKey(parsed.data.value);
    return apiKeyPresenceResponseSchema.parse({ present: true });
  });

  app.delete("/api/settings/api-key", async () => {
    await deps.apiKeyStore.deleteApiKey();
    return apiKeyPresenceResponseSchema.parse({ present: false });
  });
}
