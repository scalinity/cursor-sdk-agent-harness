import { app, BrowserWindow, nativeImage, protocol, type BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";
import { registerDialogHandlers } from "./dialogs.js";
import { buildAppMenu } from "./menu.js";
import { registerAppProtocol } from "./app-protocol.js";
import { loadWindowState, saveWindowState } from "./window-state.js";
import { BrowserController } from "./browser-controller.js";
import { registerBrowserIpc } from "./browser-ipc.js";

// Register `app://` as a STANDARD, secure, fetch/CORS-capable scheme BEFORE
// app ready. Without `standard: true`, Chromium serializes the renderer's
// origin as the opaque string "null" — so the cross-origin API requests to
// the embedded server arrive with `Origin: null`, which the server's origin
// policy rejects (403). Marking it standard gives the renderer a real
// `app://harness` origin, which the server allowlists in desktop mode.
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
let serverClose: (() => Promise<void>) | null = null;
// Owns the embedded Chromium views (one isolated session per agent). Created
// once; the host window is (re)attached on each window creation.
const browserController = new BrowserController();
// Resolved origin of the embedded server (e.g. http://127.0.0.1:4783). Passed
// to the renderer via preload so the app://harness renderer can reach the
// API/WS cross-origin. Null until the server starts (or if it fails to).
let serverOrigin: string | null = null;

const isDev = process.env.HARNESS_DEV === "1";
const DEV_URL = process.env.HARNESS_DEV_URL ?? "http://127.0.0.1:5173";

async function startEmbeddedServer(): Promise<void> {
  // @harness/server emits ESM (`apps/server` has `"type": "module"`); the
  // desktop main is CJS (`"type": "commonjs"`). Native dynamic `import()`
  // is the only supported bridge — `require()` of ESM throws ERR_REQUIRE_ESM.
  const mod = (await import("@harness/server/dist/programmatic.js")) as {
    startServer: (
      opts?: { envOverrides?: NodeJS.ProcessEnv },
    ) => Promise<{ close: () => Promise<void>; url: string }>;
  };
  const started = await mod.startServer({
    envOverrides: { HARNESS_DESKTOP: "1" },
  });
  serverClose = started.close;
  serverOrigin = started.url;
}

async function startEmbeddedServerSafe(): Promise<void> {
  try {
    await startEmbeddedServer();
  } catch (err: unknown) {
    console.error("[harness-desktop] failed to start embedded server:", err);
  }
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
      // Hand the embedded server's origin to the preload so the packaged
      // (app://harness) renderer can call the API/WS cross-origin. Empty in
      // dev where the renderer is same-origin behind the Vite proxy.
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

  if (isDev && process.platform === "darwin" && app.dock) {
    // Packaged builds get the dock icon from the bundle's .icns; in dev we
    // run unpackaged so the dock would otherwise show Electron's default.
    const devIcon = nativeImage.createFromPath(join(__dirname, "..", "build", "icon.png"));
    if (!devIcon.isEmpty()) app.dock.setIcon(devIcon);
  }

  await startEmbeddedServerSafe();

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

app.on("before-quit", (event: Electron.Event) => {
  if (serverClose) {
    event.preventDefault();
    const close = serverClose;
    serverClose = null;
    void (async () => {
      try {
        await close();
      } catch (err: unknown) {
        console.error("[harness-desktop] server close failed:", err);
      }
      app.quit();
    })();
  }
});
