/* global console, process */
/**
 * Package the macOS desktop app.
 *
 * Wraps `electron-builder --mac` to guarantee node-gyp has a usable Python.
 * electron-builder's @electron/rebuild compiles node-pty (a native dep of the
 * embedded terminal) from source — node-pty's custom prebuild scheme isn't
 * auto-detected, and @electron/rebuild's worker is pinned to node-gyp 9's
 * callback API (newer node-gyp deadlocks it). node-gyp 9's bundled gyp imports
 * the `distutils` module, which was removed from Python ≥3.12. On a machine
 * whose only Pythons are 3.13/3.14, the build fails with "No module named
 * distutils".
 *
 * Fix: provision a small, gitignored venv with `setuptools` (which re-provides
 * `distutils`) and point node-gyp at it via the PYTHON env var. Created once,
 * reused thereafter. No system Python is modified and no machine-specific path
 * is committed.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venvDir = path.join(desktopDir, ".gyp-venv");
const venvPython = path.join(venvDir, "bin", "python");

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${res.status ?? res.signal}`);
  }
}

if (!existsSync(venvPython)) {
  // Prefer python3.13 — node-gyp 9's bundled gyp predates 3.14; 3.13 is the
  // newest it handles cleanly. Fall back to whatever python3 exists.
  const candidates = ["python3.13", "python3.12", "python3"];
  const python =
    candidates.find((p) => spawnSync(p, ["--version"]).status === 0) ?? "python3";
  console.log(`[package-mac] creating gyp venv with ${python}`);
  run(python, ["-m", "venv", venvDir]);
  run(venvPython, ["-m", "pip", "install", "--quiet", "--upgrade", "pip", "setuptools"]);
}

console.log(`[package-mac] node-gyp PYTHON=${venvPython}`);
run("electron-builder", ["--mac"], {
  cwd: desktopDir,
  env: { ...process.env, PYTHON: venvPython },
});
