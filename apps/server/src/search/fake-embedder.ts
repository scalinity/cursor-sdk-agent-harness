import type { Embedder, EmbedProgress } from "./embedder.js";
import { EMBEDDING_DIMENSION } from "./vector.js";

/**
 * Deterministic, dependency-free embedder for tests.
 *
 * It is a hashing vectorizer: text is tokenized into lowercase word tokens,
 * each token is hashed into one of `dimension` buckets, and the resulting
 * bag-of-tokens vector is L2-normalized. This gives a genuine (if crude)
 * lexical signal — a query and a chunk that share words score a positive
 * cosine — which lets the search/indexer mechanics be tested without
 * downloading the 80MB ONNX model. True semantic relevance is exercised by
 * the RUN_EMBED_SMOKE-gated test and the end-of-phase manual smoke.
 */
export class FakeEmbedder implements Embedder {
  readonly dimension: number;

  constructor(dimension: number = EMBEDDING_DIMENSION) {
    this.dimension = dimension;
  }

  initialize(onProgress?: (p: EmbedProgress) => void): Promise<void> {
    onProgress?.({ status: "ready" });
    return Promise.resolve();
  }

  embed(text: string): Promise<Float32Array> {
    return Promise.resolve(this.vectorize(text));
  }

  embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.resolve(texts.map((t) => this.vectorize(t)));
  }

  private vectorize(text: string): Float32Array {
    const vec = new Float32Array(this.dimension);
    const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
    for (const token of tokens) {
      const idx = hashToken(token) % this.dimension;
      vec[idx] = (vec[idx] ?? 0) + 1;
    }
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += (vec[i] ?? 0) ** 2;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] = (vec[i] ?? 0) / norm;
    }
    return vec;
  }
}

function hashToken(token: string): number {
  // FNV-1a 32-bit — deterministic, well-distributed.
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
