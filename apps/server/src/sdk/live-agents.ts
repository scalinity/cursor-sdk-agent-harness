import type { FastifyBaseLogger } from "fastify";
import type { SDKAgent } from "./sdk-adapter.js";

/**
 * Bounded LRU cache of live SDK agent handles, keyed by `agentId`. The
 * harness reuses a single `SDKAgent` instance across multiple `startRun`
 * calls to the same agent (per spec §4 Run Lifecycle: "Subsequent prompts
 * to the same agent reuse the same durable agent handle"); without a
 * bound, a long-lived single-user process that creates+resumes many
 * agents accumulates handles indefinitely, each carrying a connect-rpc
 * client and possibly child processes.
 *
 * Eviction:
 *   - `set(agentId, handle)` evicts the least-recently-`get`/`set`'d
 *     entry when capacity is exceeded.
 *   - On eviction, `handle.close()` is called (best-effort, errors logged
 *     but not thrown). The corresponding row in `agents` is unchanged —
 *     this cache is purely an in-memory optimisation, not a source of
 *     truth.
 *
 * Capacity defaults to 32, configurable via the constructor for tests.
 * Single-user local workload: a typical session has 1-3 active agents;
 * 32 leaves comfortable headroom for resume-heavy workflows.
 */
export interface LiveAgentsOptions {
  capacity?: number;
  logger?: FastifyBaseLogger;
}

export class LiveAgents {
  private readonly capacity: number;
  private readonly cache = new Map<string, SDKAgent>();
  private readonly logger: FastifyBaseLogger | undefined;

  constructor(opts: LiveAgentsOptions = {}) {
    this.capacity = opts.capacity ?? 32;
    this.logger = opts.logger;
  }

  get(agentId: string): SDKAgent | undefined {
    const handle = this.cache.get(agentId);
    if (handle === undefined) return undefined;
    // Promote to most-recently-used by re-inserting at the tail.
    this.cache.delete(agentId);
    this.cache.set(agentId, handle);
    return handle;
  }

  set(agentId: string, handle: SDKAgent): void {
    if (this.cache.has(agentId)) {
      this.cache.delete(agentId);
    } else if (this.cache.size >= this.capacity) {
      // Evict the least-recently-used. Map preserves insertion order, so
      // the first key is the LRU.
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        const evicted = this.cache.get(firstKey);
        this.cache.delete(firstKey);
        if (evicted) {
          try {
            evicted.close();
          } catch (err) {
            this.logger?.warn(
              { err, agentId: firstKey },
              "LiveAgents: handle.close() threw on LRU eviction",
            );
          }
        }
      }
    }
    this.cache.set(agentId, handle);
  }

  delete(agentId: string): void {
    this.cache.delete(agentId);
  }

  values(): IterableIterator<SDKAgent> {
    return this.cache.values();
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}
