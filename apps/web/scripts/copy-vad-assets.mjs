/**
 * Copy the @ricky0123/vad-web runtime assets into apps/web/public/vad/ so they
 * are served from the app's own origin. The dictation feature must work fully
 * offline inside the packaged Electron app (the `app://harness` origin has no
 * CDN access). MicVAD loads its worklet and the Silero model by URL from
 * `baseAssetPath`, so those two must be self-hosted. onnxruntime-web's WASM is
 * NOT copied here — Vite bundles it as a hashed asset and ort loads it from
 * there, which guarantees the build variant (asyncify/jsep/plain) always
 * matches; self-hosting a fixed variant would risk a 404 mismatch.
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

const outDir = join(here, "..", "public", "vad");
mkdirSync(outDir, { recursive: true });

/** @type {ReadonlyArray<readonly [string, string]>} */
const assets = [
  [join(vadDir, "dist", "vad.worklet.bundle.min.js"), "vad.worklet.bundle.min.js"],
  [join(vadDir, "dist", "silero_vad_v5.onnx"), "silero_vad_v5.onnx"],
];

for (const [src, name] of assets) {
  copyFileSync(src, join(outDir, name));
}
console.log(`[vad] copied ${assets.length} asset(s) to public/vad/`);
