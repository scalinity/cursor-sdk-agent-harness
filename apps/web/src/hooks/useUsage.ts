import { useCallback, useEffect, useState } from "react";
import {
  usageBreakdownResponseSchema,
  usageDailyResponseSchema,
  usageSummaryResponseSchema,
  type PricingFreshness,
  type UsageBreakdownRow,
  type UsageDailyPoint,
  type UsageSummary,
} from "@harness/shared";
import { httpRequest, type HttpError } from "../lib/http-client.js";

export type UseUsageInput = {
  from: Date;
  to: Date;
  agentId?: string;
  modelId?: string;
};

export type UseUsageResult = {
  summary: UsageSummary | null;
  daily: UsageDailyPoint[];
  byModel: UsageBreakdownRow[];
  byAgent: UsageBreakdownRow[];
  pricingFreshness: PricingFreshness;
  loading: boolean;
  error: HttpError | Error | null;
  reload: () => Promise<void>;
};

const DEFAULT_FRESHNESS: PricingFreshness = {
  lastVerifiedAt: null,
  staleness: "never_verified",
};

function queryFor(input: UseUsageInput): Record<string, string | undefined> {
  return {
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    agentId: input.agentId,
    modelId: input.modelId,
  };
}

export function useUsage(input: UseUsageInput): UseUsageResult {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [daily, setDaily] = useState<UsageDailyPoint[]>([]);
  const [byModel, setByModel] = useState<UsageBreakdownRow[]>([]);
  const [byAgent, setByAgent] = useState<UsageBreakdownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<HttpError | Error | null>(null);

  const fromIso = input.from.toISOString();
  const toIso = input.to.toISOString();
  const { agentId, modelId } = input;

  const reload = useCallback(async () => {
    const input: UseUsageInput = { from: new Date(fromIso), to: new Date(toIso) };
    if (agentId !== undefined) input.agentId = agentId;
    if (modelId !== undefined) input.modelId = modelId;
    const query = queryFor(input);
    setLoading(true);
    setError(null);
    try {
      const [nextSummary, nextDaily, nextByModel, nextByAgent] = await Promise.all([
        httpRequest("/api/usage/summary", { query, responseSchema: usageSummaryResponseSchema }),
        httpRequest("/api/usage/daily", { query, responseSchema: usageDailyResponseSchema }),
        httpRequest("/api/usage/by-model", { query, responseSchema: usageBreakdownResponseSchema }),
        httpRequest("/api/usage/by-agent", { query, responseSchema: usageBreakdownResponseSchema }),
      ]);
      setSummary(nextSummary);
      setDaily(nextDaily);
      setByModel(nextByModel.items);
      setByAgent(nextByAgent.items);
    } catch (e) {
      setError(e instanceof Error ? e : new Error("usage load failed"));
    } finally {
      setLoading(false);
    }
  }, [agentId, fromIso, modelId, toIso]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    summary,
    daily,
    byModel,
    byAgent,
    pricingFreshness: summary?.pricingFreshness ?? DEFAULT_FRESHNESS,
    loading,
    error,
    reload,
  };
}
