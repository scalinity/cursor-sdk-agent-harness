/**
 * Phase 23 — Float32 vector (de)serialization + cosine similarity.
 *
 * Embeddings are stored as raw little-endian Float32 bytes in a BLOB column.
 * better-sqlite3 hands BLOBs back as Node Buffers; reconstructing a typed
 * array from a Buffer requires a fresh, 4-byte-aligned ArrayBuffer (Buffer
 * pooling can leave a non-aligned byteOffset that breaks `new Float32Array`).
 */

export const EMBEDDING_DIMENSION = 384;

export function float32ToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function bufferToFloat32(buf: Buffer): Float32Array {
  // Copy into a fresh ArrayBuffer to guarantee alignment + ownership.
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new Float32Array(ab);
}

/**
 * Cosine similarity in [-1, 1]. Vectors from all-MiniLM-L6-v2 are L2-normalized
 * so this is effectively a dot product, but the full form is kept so the
 * function is correct for any stored vector (and for the deterministic fake
 * embedder used in tests).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
