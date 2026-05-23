import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pino } from "pino";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories, type Repositories } from "../../db/repositories/index.js";
import { createPerfCounters, type PerfCounters } from "../../observability/perf-counters.js";
import { createPersistAndBroadcast } from "../../sdk/persist-and-broadcast.js";
import { createRunBus } from "../../ws/run-bus.js";

/**
 * Phase 14 stress fixture for spec §13 budget rows:
 *
 *   - SDK event received → DB commit: p50 <8ms, p95 <25ms
 *   - DB commit → WS broadcast:       p50 <5ms
 *   - Sustained event rate:           100 events/sec (10k in <100s)
 *
 * We drive the pipeline directly (no HTTP, no WS upgrade) so the numbers
 * reflect the durable persistence + bus broadcast cost — which is what
 * spec §13 actually budgets — without socket noise on CI.
 *
 * The test creates one agent + one run, then ingests 10,000 stub SDK
 * `assistant` deltas while a single bus subscriber records the post-commit
 * broadcast. Every event lands in the DB (gapless seq), the recorder shows
 * the budget is met, and 10,000 broadcasts arrive at the subscriber.
 *
 * Runtime budget: ≤60s on a current MBP. If this exceeds 60s, the WS
 * broadcast or DB writes are the bottleneck — investigate the perf counters.
 */

const TOTAL_EVENTS = 10_000;

interface Ctx {
  repos: Repositories;
  perf: PerfCounters;
  cleanup: () => void;
}

function setup(): Ctx {
  const dbClient = openTestDb();
  const repos = createRepositories(dbClient.raw);
  const perf = createPerfCounters({ ringSize: TOTAL_EVENTS });
  return {
    repos,
    perf,
    cleanup: () => {
      dbClient.raw.close();
    },
  };
}

describe("stress: 10k events through persist-and-broadcast", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.cleanup();
  });

  it(
    "ingests 10,000 events with no gaps, all received by the bus, within budget",
    async () => {
      const { repos, perf } = ctx;
      const agentId = "perf-agent";
      const runId = "perf-run";

      // Seed an agent + run so the foreign keys resolve.
      repos.agents.create({
        id: agentId,
        name: "stress",
        status: "active",
        mode: "local",
        modelId: "composer-2-5-fast",
        cwd: [],
        mcpServerIds: [],
        subagentDefinitionIds: [],
        sandboxEnabled: true,
      });
      repos.runs.create({
        id: runId,
        agentId,
        status: "RUNNING",
        modelId: "composer-2-5-fast",
        promptPreview: "stress",
        mode: "local",
      });

      const bus = createRunBus();
      // Quiet pino logger so the test output stays focused on the perf summary.
      const logger = pino({ level: "silent" }) as unknown as Parameters<
        typeof createPersistAndBroadcast
      >[0]["logger"];
      const pipeline = createPersistAndBroadcast({
        events: repos.events,
        bus,
        logger,
        perfCounters: perf,
      });

      // Single subscriber records each broadcast so we can assert the count.
      const received: number[] = [];
      const unsubscribe = bus.subscribe(runId, (row) => {
        received.push(row.seq);
      });

      const wallStart = performance.now();
      for (let i = 1; i <= TOTAL_EVENTS; i += 1) {
        pipeline.ingestSDKMessage({
          raw: {
            type: "assistant",
            agent_id: agentId,
            run_id: runId,
            message: {
              role: "assistant",
              content: [{ type: "text", text: `tok-${i.toString()} ` }],
            },
          },
          runId,
          agentId,
          agentMode: "local",
          occurredAt: new Date().toISOString(),
        });
      }

      // The bus dispatches via setImmediate — flush the queue before
      // asserting. Two macrotask hops are sufficient because each
      // listener runs synchronously inside its setImmediate.
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setImmediate(r));

      const wallElapsed = performance.now() - wallStart;

      unsubscribe();

      // Gapless persistence: every event row 1..N lands.
      const rows = repos.events.getByRunIdAfterSeq(runId, 0, TOTAL_EVENTS + 1);
      expect(rows.length).toBe(TOTAL_EVENTS);
      const seqs = rows.map((r) => r.seq);
      const firstGap = seqs.findIndex((seq, idx) => seq !== idx + 1);
      expect(firstGap).toBe(-1);
      expect(seqs[seqs.length - 1]).toBe(TOTAL_EVENTS);

      // Bus delivered every committed event to the live subscriber.
      expect(received.length).toBe(TOTAL_EVENTS);

      // Perf budget assertions (spec §13).
      const commit = perf.snapshot("sdk_event_received_to_db_commit_ms");
      const broadcast = perf.snapshot("db_commit_to_ws_broadcast_ms");
      console.info(
        `[stress] ${TOTAL_EVENTS.toString()} events in ${wallElapsed.toFixed(0)}ms` +
          ` | commit p50=${(commit.p50 ?? 0).toFixed(3)}ms p95=${(commit.p95 ?? 0).toFixed(3)}ms` +
          ` | broadcast p50=${(broadcast.p50 ?? 0).toFixed(3)}ms`,
      );

      expect(commit.count).toBe(TOTAL_EVENTS);
      expect(broadcast.count).toBe(TOTAL_EVENTS);
      // Spec §13: SDK event → DB commit p50 < 8ms, p95 < 25ms.
      expect(commit.p50).toBeLessThan(8);
      expect(commit.p95).toBeLessThan(25);
      // Spec §13: DB commit → WS broadcast p50 < 5ms.
      expect(broadcast.p50).toBeLessThan(5);

      // Sustained throughput: 100 events/sec means 10k in <100s. We give
      // a more aggressive 60s cap to catch regressions early.
      expect(wallElapsed).toBeLessThan(60_000);
    },
    120_000,
  );
});
