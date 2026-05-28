import {
  app,
  BrowserWindow,
  nativeImage,
  protocol,
  session,
  systemPreferences,
  type BrowserWindowConstructorOptions,
} from "electron";
import { join } from "node:path";
import { registerDialogHandlers } from "./dialogs.js";
import { buildAppMenu } from "./menu.js";
import { registerAppProtocol } from "./app-protocol.js";
import { loadWindowState, saveWindowState } from "./window-state.js";
import { BrowserController } from "./browser-controller.js";
import { registerBrowserIpc } from "./browser-ipc.js";
import { rendererServerOrigin, resolveHarnessServerUrl } from "./server-url.js";

// On-device Whisper dictation prefers the WebGPU backend (≈10x faster than
// WASM). Enable it explicitly so `navigator.gpu` is exposed to the renderer and
// its worker, even if this GPU sits on Chromium's conservative blocklist for
// the bundled Electron build. Must run before `app.whenReady`.
app.commandLine.appendSwitch("enable-unsafe-webgpu");

// Register `app://` as a STANDARD, secure, fetch/CORS-capable scheme BEFORE
// app ready. Without `standard: true`, Chromium serializes the renderer's
// origin as the opaque string "null" — cross-origin API requests to the
// standalone harness server would arrive with `Origin: null`, which the
// server's origin policy rejects (403). Marking it standard gives the renderer
// a real `app://harness` origin, which the server allowlists when
// `HARNESS_DESKTOP=1`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
// Owns the embedded Chromium views (one isolated session per agent). Created
// once; the host window is (re)attached on each window creation.
const browserController = new BrowserController();
// External harness server origin for packaged mode (app://harness). Null in dev
// where the renderer loads from Vite and the proxy handles API/WS.
const serverOrigin = rendererServerOrigin(process.env.HARNESS_DEV === "1");

const isDev = process.env.HARNESS_DEV === "1";
const DEV_URL = process.env.HARNESS_DEV_URL ?? "http://127.0.0.1:5173";

async function warnIfServerUnreachable(): Promise<void> {
  if (isDev || !serverOrigin) return;
  const healthUrl = `${serverOrigin}/api/health/live`;
  try {
    const res = await fetch(healthUrl, {
      headers: { Origin: "app://harness" },
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) {
      console.warn(
        `[harness-desktop] harness server at ${serverOrigin} returned ${res.status}. ` +
          "Start it with: HARNESS_DESKTOP=1 pnpm start:server",
      );
    }
  } catch (err: unknown) {
    console.warn(
      `[harness-desktop] cannot reach harness server at ${serverOrigin} (${err instanceof Error ? err.message : String(err)}). ` +
        "Start it with: HARNESS_DESKTOP=1 pnpm start:server",
    );
  }
}

// The renderer's voice-dictation feature calls getUserMedia for the mic. By
// default Chromium would block the permission request inside Electron, so we
// grant exactly the audio-capture permissions (nothing else) and, on macOS,
// route through the OS TCC prompt so the system mic-access dialog appears.
// Pairs with `com.apple.security.device.audio-input` + NSMicrophoneUsageDescription.
function setupMediaPermissions(): void {
  const MIC_PERMISSIONS = new Set(["media", "audioCapture", "microphone"]);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    if (!MIC_PERMISSIONS.has(permission)) {
      callback(false);
      return;
    }
    if (process.platform === "darwin") {
      systemPreferences.askForMediaAccess("microphone").then(
        (granted) => callback(granted),
        () => callback(false),
      );
      return;
    }
    callback(true);
  });
  ses.setPermissionCheckHandler((_wc, permission) => MIC_PERMISSIONS.has(permission));
}

function createWindow(): void {
  const state = loadWindowState();
  const opts: BrowserWindowConstructorOptions = {
    width: state.width,
    height: state.height,
    minWidth: 1280,
    minHeight: 800,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#1a1612",
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Packaged renderer (app://harness) reaches the external server cross-
      // origin. Dev loads Vite same-origin — no flag needed.
      additionalArguments: serverOrigin
        ? [`--harness-server-origin=${serverOrigin}`]
        : [],
    },
  };
  if (state.x !== undefined) opts.x = state.x;
  if (state.y !== undefined) opts.y = state.y;
  mainWindow = new BrowserWindow(opts);
  browserController.attach(mainWindow);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (state.maximized) mainWindow?.maximize();
  });

  const persistState = (): void => {
    if (!mainWindow) return;
    const b = mainWindow.getBounds();
    saveWindowState({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      maximized: mainWindow.isMaximized(),
    });
  };
  mainWindow.on("resize", persistState);
  mainWindow.on("move", persistState);
  mainWindow.on("maximize", persistState);
  mainWindow.on("unmaximize", persistState);

  mainWindow.on("closed", () => {
    browserController.detachWindow();
    mainWindow = null;
  });

  if (isDev) {
    void mainWindow.loadURL(DEV_URL);
  } else {
    // Load the protocol ROOT (path "/"), not "/index.html". The renderer's
    // BrowserRouter matches on location.pathname; "/index.html" matches no
    // route and renders a blank window. The app-protocol handler resolves a
    // bare "/" to index.html on disk.
    void mainWindow.loadURL("app://harness/");
  }
}

async function onReady(): Promise<void> {
  const rendererRoot = isDev
    ? join(__dirname, "..", "..", "web", "dist")
    : join((process as NodeJS.Process & { resourcesPath: string }).resourcesPath, "renderer");
  registerAppProtocol(rendererRoot);
  registerDialogHandlers();
  registerBrowserIpc(browserController, () => mainWindow);
  setupMediaPermissions();

  if (isDev && process.platform === "darwin" && app.dock) {
    // Packaged builds get the dock icon from the bundle's .icns; in dev we
    // run unpackaged so the dock would otherwise show Electron's default.
    const devIcon = nativeImage.createFromPath(join(__dirname, "..", "build", "icon.png"));
    if (!devIcon.isEmpty()) app.dock.setIcon(devIcon);
  }

  if (!isDev) {
    console.log(
      `[harness-desktop] using external harness server at ${resolveHarnessServerUrl()} ` +
        "(override with HARNESS_SERVER_URL)",
    );
    await warnIfServerUnreachable();
  }

  createWindow();
  buildAppMenu(() => mainWindow);
}

app.whenReady().then(onReady).catch((err: unknown) => {
  console.error("[harness-desktop] app.whenReady failed:", err);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
