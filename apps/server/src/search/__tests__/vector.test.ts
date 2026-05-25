import { describe, it, expect } from "vitest";
import { bufferToFloat32, cosineSimilarity, float32ToBuffer } from "../vector.js";

describe("vector", () => {
  it("round-trips Float32Array through a Buffer", () => {
    const vec = new Float32Array([0.1, -0.5, 1.25, 0, 42]);
    const restored = bufferToFloat32(float32ToBuffer(vec));
    expect(Array.from(restored)).toEqual(Array.from(vec));
  });

  it("survives a non-aligned source Buffer", () => {
    const vec = new Float32Array([1, 2, 3, 4]);
    // Emulate better-sqlite3 returning a Buffer view into a larger pool.
    const pool = Buffer.alloc(float32ToBuffer(vec).byteLength + 3);
    float32ToBuffer(vec).copy(pool, 3);
    const sliced = pool.subarray(3);
    expect(Array.from(bufferToFloat32(sliced))).toEqual([1, 2, 3, 4]);
  });

  it("cosine of identical vectors is 1", () => {
    const a = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 6);
  });

  it("cosine of orthogonal vectors is 0", () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6);
  });

  it("cosine of a zero vector is 0 (no NaN)", () => {
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
  });
});
