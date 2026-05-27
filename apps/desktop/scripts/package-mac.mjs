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
 *
 * Post-packaging: @electron/rebuild silently leaves better-sqlite3 compiled for
 * system Node (NMV 147) instead of Electron (NMV 130). We force-rebuild it
 * inside the packaged .app, then re-sign so the code signature covers the
 * replaced binary.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopDir, "../..");
const venvDir = path.join(desktopDir, ".gyp-venv");
const venvPython = path.join(venvDir, "bin", "python");

const ELECTRON_VERSION = JSON.parse(
  readFileSync(path.join(desktopDir, "package.json"), "utf8"),
).devDependencies.electron;

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${res.status ?? res.signal}`);
  }
}

function findBetterSqlite3BindingGyp(version) {
  const pnpmDir = path.join(repoRoot, "node_modules/.pnpm");
  const exact = path.join(
    pnpmDir,
    `better-sqlite3@${version}`,
    "node_modules/better-sqlite3/binding.gyp",
  );
  if (existsSync(exact)) return exact;

  const prefix = `better-sqlite3@${version}`;
  const candidateDir = readdirSync(pnpmDir).find((entry) => entry.startsWith(prefix));
  if (!candidateDir) return null;
  const candidate = path.join(
    pnpmDir,
    candidateDir,
    "node_modules/better-sqlite3/binding.gyp",
  );
  return existsSync(candidate) ? candidate : null;
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

// ---------------------------------------------------------------------------
// Post-packaging: force-rebuild better-sqlite3 for Electron inside the .app
// ---------------------------------------------------------------------------
const distElectron = path.join(desktopDir, "dist-electron");
const macArm64 = path.join(distElectron, "mac-arm64");

// electron-builder names the output dir mac-arm64 on Apple Silicon
const appDir = readdirSync(macArm64).find((f) => f.endsWith(".app"));
if (!appDir) {
  throw new Error("[package-mac] cannot find .app in dist-electron/mac-arm64");
}

const finalAppPath = path.join(macArm64, appDir);
const rebuildAppPath = appDir.includes(" ") ? path.join(macArm64, appDir.replace(/\s+/g, "")) : finalAppPath;
let appPath = finalAppPath;
if (rebuildAppPath !== finalAppPath) {
  rmSync(rebuildAppPath, { recursive: true, force: true });
  renameSync(finalAppPath, rebuildAppPath);
  appPath = rebuildAppPath;
}

function restoreFinalAppPath() {
  if (appPath === finalAppPath || !existsSync(appPath)) return;
  rmSync(finalAppPath, { recursive: true, force: true });
  renameSync(appPath, finalAppPath);
  appPath = finalAppPath;
}

const betterSqlite3Dir = path.join(
  appPath,
  "Contents/Resources/app/node_modules/better-sqlite3",
);

if (existsSync(betterSqlite3Dir)) {
  try {
    const packagedPackageJson = JSON.parse(
      readFileSync(path.join(betterSqlite3Dir, "package.json"), "utf8"),
    );
    const packagedBindingGyp = path.join(betterSqlite3Dir, "binding.gyp");
    if (!existsSync(packagedBindingGyp)) {
      const sourceBindingGyp = findBetterSqlite3BindingGyp(packagedPackageJson.version);
      if (!sourceBindingGyp) {
        throw new Error(
          `[package-mac] cannot find source binding.gyp for better-sqlite3 ${packagedPackageJson.version}`,
        );
      }
      copyFileSync(sourceBindingGyp, packagedBindingGyp);
    }

    console.log(
      `[package-mac] force-rebuilding better-sqlite3 for Electron ${ELECTRON_VERSION} (ABI 130)`,
    );
    run(
      "npx",
      [
        "--yes",
        "node-gyp@9",
        "rebuild",
        `--target=${ELECTRON_VERSION}`,
        "--arch=arm64",
        "--dist-url=https://electronjs.org/headers",
        "--build-from-source",
        `--python=${venvPython}`,
      ],
      { cwd: betterSqlite3Dir },
    );
  } finally {
    restoreFinalAppPath();
  }

  // Re-sign — the binary we just replaced invalidates the existing signature.
  // Use the same Developer ID identity electron-builder used; ad-hoc (`-`)
  // breaks keytar at runtime. Find the first valid codesigning identity.
  const idResult = spawnSync("security", [
    "find-identity", "-v", "-p", "codesigning",
  ]);
  const idLine = (idResult.stdout?.toString() ?? "").split("\n").find((l) => l.includes('"'));
  const identityMatch = idLine?.match(/"(.+?)"/);
  const identity = identityMatch?.[1] ?? "-";
  console.log(`[package-mac] re-signing app with identity: ${identity}`);
  run("codesign", ["--deep", "--force", "--sign", identity, appPath]);
} else {
  console.warn("[package-mac] better-sqlite3 not found in app bundle — skipping rebuild");
}
