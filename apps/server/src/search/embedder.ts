import os from "node:os";
import path from "node:path";
import { EMBEDDING_DIMENSION } from "./vector.js";

/**
 * Phase 23 — In-process text embedding via all-MiniLM-L6-v2 (384-dim).
 *
 * The model runs through @xenova/transformers on the ONNX **WASM** backend
 * (onnxruntime-node's native build is intentionally skipped at install time,
 * so transformers.js falls back to onnxruntime-web). No Python, no FAISS, no
 * external service — the phase's hard constraint.
 *
 * The heavy module is loaded lazily via dynamic import on first use so server
 * boot stays fast and a machine that never indexes never pays the cost. The
 * ~80MB model is downloaded from HuggingFace on first use and cached under
 * the harness data dir.
 */

export interface EmbedProgress {
  status: string;
  file?: string;
  /** 0–100 download progress when the runtime reports it. */
  progress?: number;
}

export interface Embedder {
  readonly dimension: number;
  /** Load the model (idempotent). Reports download progress if provided. */
  initialize(onProgress?: (p: EmbedProgress) => void): Promise<void>;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

export const EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/**
 * P23 CA1-S1: the model (~80MB) is downloaded from HuggingFace on first index
 * (network egress for an otherwise-local app — documented intentionally). Pin
 * a commit SHA here instead of a moving tag to make the artifact reproducible
 * / build-time verifiable in production.
 */
export const EMBEDDING_MODEL_REVISION = "main";

/** Default model cache dir: ~/Library/Application Support/<app>/models on macOS. */
export function defaultModelCacheDir(): string {
  const appName = "cursor-sdk-agent-harness";
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", appName, "models");
  }
  if (process.platform === "win32") {
    const base = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, appName, "models");
  }
  const base = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(base, appName, "models");
}

// Minimal structural type for the transformers.js pieces we touch. Avoids a
// hard type dependency at module load (the package is dynamically imported).
interface FeatureExtractionOutput {
  data: Float32Array;
  dims: number[];
}
type FeatureExtractor = (
  input: string | string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<FeatureExtractionOutput>;

export interface XenovaEmbedderOptions {
  cacheDir?: string;
  /** Override the dynamic import — tests inject a fake transformers module. */
  loadModule?: () => Promise<unknown>;
}

export class XenovaEmbedder implements Embedder {
  readonly dimension = EMBEDDING_DIMENSION;
  private extractor: FeatureExtractor | null = null;
  private loadPromise: Promise<void> | null = null;
  private readonly cacheDir: string;
  private readonly loadModule: () => Promise<unknown>;

  constructor(options: XenovaEmbedderOptions = {}) {
    this.cacheDir = options.cacheDir ?? defaultModelCacheDir();
    this.loadModule =
      options.loadModule ?? (() => import("@xenova/transformers") as Promise<unknown>);
  }

  initialize(onProgress?: (p: EmbedProgress) => void): Promise<void> {
    if (this.extractor) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doInitialize(onProgress).catch((err) => {
      // Reset so a later retry can re-attempt after a transient download fail.
      this.loadPromise = null;
      throw err;
    });
    return this.loadPromise;
  }

  private async doInitialize(onProgress?: (p: EmbedProgress) => void): Promise<void> {
    const mod = (await this.loadModule()) as {
      pipeline: (
        task: string,
        model: string,
        options?: Record<string, unknown>,
      ) => Promise<FeatureExtractor>;
      env: {
        allowLocalModels: boolean;
        cacheDir?: string;
        backends: { onnx: { wasm: { numThreads: number } } };
      };
    };
    mod.env.allowLocalModels = false;
    mod.env.cacheDir = this.cacheDir;
    // Single-threaded WASM is the most portable across Node + bundled Electron.
    mod.env.backends.onnx.wasm.numThreads = 1;
    this.extractor = await mod.pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
      revision: EMBEDDING_MODEL_REVISION,
      progress_callback: (p: unknown) => {
        if (!onProgress) return;
        const rec = (p ?? {}) as { status?: string; file?: string; progress?: number };
        onProgress({
          status: rec.status ?? "loading",
          ...(rec.file !== undefined ? { file: rec.file } : {}),
          ...(rec.progress !== undefined ? { progress: rec.progress } : {}),
        });
      },
    });
  }

  async embed(text: string): Promise<Float32Array> {
    const [vec] = await this.embedBatch([text]);
    if (!vec) throw new Error("embed: empty result");
    return vec;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    await this.initialize();
    if (!this.extractor) throw new Error("embedder not initialized");
    const out = await this.extractor(texts, { pooling: "mean", normalize: true });
    const dim = out.dims[out.dims.length - 1] ?? this.dimension;
    const result: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      result.push(out.data.slice(i * dim, (i + 1) * dim));
    }
    return result;
  }
}

export function createEmbedder(options: XenovaEmbedderOptions = {}): Embedder {
  return new XenovaEmbedder(options);
}
