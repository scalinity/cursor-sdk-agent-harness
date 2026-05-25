import { describe, it, expect } from "vitest";
import { FakeEmbedder } from "../fake-embedder.js";
import { createEmbedder } from "../embedder.js";
import { cosineSimilarity } from "../vector.js";

const RUN_SMOKE = process.env.RUN_EMBED_SMOKE === "true";

describe("FakeEmbedder", () => {
  it("produces 384-dim vectors", async () => {
    const e = new FakeEmbedder();
    const v = await e.embed("hello world");
    expect(v.length).toBe(384);
    expect(e.dimension).toBe(384);
  });

  it("embeds a batch with one vector per input", async () => {
    const e = new FakeEmbedder();
    const vecs = await e.embedBatch(["a", "b c", "d e f"]);
    expect(vecs).toHaveLength(3);
    expect(vecs.every((v) => v.length === 384)).toBe(true);
  });

  it("is deterministic and lexically sensitive", async () => {
    const e = new FakeEmbedder();
    const [q] = await e.embedBatch(["authenticate user login session"]);
    const [related] = await e.embedBatch(["function authenticate(user) { return session; }"]);
    const [unrelated] = await e.embedBatch(["pixel color gradient render canvas"]);
    expect(cosineSimilarity(q!, related!)).toBeGreaterThan(cosineSimilarity(q!, unrelated!));
    const again = await e.embed("authenticate user login session");
    expect(Array.from(again)).toEqual(Array.from(q!));
  });
});

describe.skipIf(!RUN_SMOKE)("XenovaEmbedder (RUN_EMBED_SMOKE)", () => {
  it("loads all-MiniLM-L6-v2 and produces 384-dim normalized vectors", async () => {
    const e = createEmbedder();
    const [v] = await e.embedBatch(["function add(a, b) { return a + b; }"]);
    expect(v!.length).toBe(384);
    // L2-normalized → self cosine ~1.
    expect(cosineSimilarity(v!, v!)).toBeCloseTo(1, 4);
  }, 120_000);
});
