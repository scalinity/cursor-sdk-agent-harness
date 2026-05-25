/**
 * Copy the @ricky0123/vad-web runtime assets into apps/web/public/vad/ so they
 * are served from the app's own origin. The dictation feature must work fully
 * offline inside the packaged Electron app (the `app://harness` origin has no
 * CDN access). MicVAD loads its worklet and the Silero model by URL from
 * `baseAssetPath`; onnxruntime-web's WASM glue module is loaded via a runtime-
 * constructed dynamic `import()` that Vite can't rewrite, so we self-host the
 * glue (.mjs) and binary (.wasm) here too and point ort at them via
 * `onnxWASMBasePath`.
 *
 * Runs from the web package's `dev`/`build` scripts. The output lives under
 * public/vad/ and is gitignored (these are derived from node_modules).
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const vadDir = dirname(require.resolve("@ricky0123/vad-web/package.json"));
// Resolve onnxruntime-web from *within* the VAD package so the WASM matches the
// JS version it imports. (The package's exports map hides package.json, so we
// resolve the main entry and derive the root from the path.)
const ortMain = require.resolve("onnxruntime-web", { paths: [vadDir] });
const ortDir = ortMain.slice(
  0,
  ortMain.lastIndexOf("onnxruntime-web") + "onnxruntime-web".length,
);

const outDir = join(here, "..", "public", "vad");
mkdirSync(outDir, { recursive: true });

/** @type {ReadonlyArray<readonly [string, string]>} */
const assets = [
  [join(vadDir, "dist", "vad.worklet.bundle.min.js"), "vad.worklet.bundle.min.js"],
  [join(vadDir, "dist", "silero_vad_v5.onnx"), "silero_vad_v5.onnx"],
  // ort-web's Emscripten glue is loaded via a runtime `import()` that bundlers
  // can't rewrite, so it must live at the exact filename ort constructs.
  [join(ortDir, "dist", "ort-wasm-simd-threaded.mjs"), "ort-wasm-simd-threaded.mjs"],
  [join(ortDir, "dist", "ort-wasm-simd-threaded.wasm"), "ort-wasm-simd-threaded.wasm"],
];

for (const [src, name] of assets) {
  copyFileSync(src, join(outDir, name));
}
console.log(`[vad] copied ${assets.length} asset(s) to public/vad/`);
