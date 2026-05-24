import {
  WebContentsView,
  session,
  type BrowserWindow,
  type Session,
  type WebContents,
} from "electron";
import type {
  BrowserActionEvent,
  BrowserId,
  BrowserPushEvent,
  BrowserRect,
  BrowserState,
  ConsoleLevel,
  ConsoleMessage,
  NetworkRequest,
} from "@harness/shared" with { "resolution-mode": "import" };

/**
 * Phase 18 — Electron main-process owner of the embedded Chromium views.
 *
 * One `WebContentsView` per agent, each on an isolated persistent session
 * partition (`persist:agent-<agentId>`) so cookies / localStorage / cache /
 * IndexedDB never cross agents (spec §10). The view is created lazily on the
 * first navigate (manual URL bar or, later, an agent `browser_navigate` call)
 * and torn down — with its storage cleared — when the agent is terminated.
 *
 * The view is a *native* layer painted above the BrowserWindow's web contents,
 * positioned over a renderer placeholder div whose CSS-pixel rect the renderer
 * reports via IPC. Because it is not a DOM element, the renderer cannot draw an
 * overlay above it; the action-visualization overlay (a later milestone) must
 * be a sibling transparent `WebContentsView`, not a renderer DOM layer.
 *
 * This milestone implements the manual-driving surface only: lifecycle,
 * navigation, live state, and the console/network ring buffers. The
 * programmatic agent actions (click / type / snapshot / screenshot / evaluate /
 * wait_for) land with the built-in MCP server.
 */

const RING_CAP = 500;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Best-effort host extraction for status-strip / last-action labels. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Map Chromium's numeric console level to our enum (verbose|info|warning|error). */
function consoleLevelFromChromium(level: number): ConsoleLevel {
  switch (level) {
    case 0:
      return "debug";
    case 1:
      return "info";
    case 2:
      return "warn";
    case 3:
      return "error";
    default:
      return "log";
  }
}

/** Bounded FIFO ring with a monotonic seq stamped per push. */
class Ring<T extends { seq: number }> {
  private readonly items: T[] = [];
  private next = 0;

  push(make: (seq: number) => T): void {
    const item = make(this.next++);
    this.items.push(item);
    if (this.items.length > RING_CAP) this.items.shift();
  }

  since(seq: number | undefined): T[] {
    if (seq === undefined) return [...this.items];
    return this.items.filter((it) => it.seq >= seq);
  }
}

interface BrowserEntry {
  view: WebContentsView;
  session: Session;
  partition: string;
  console: Ring<ConsoleMessage>;
  network: Ring<NetworkRequest>;
  lastAction: string | null;
  visible: boolean;
}

export interface BrowserControllerOptions {
  /** Pushes live state / action events to the renderer (set by the IPC layer). */
  onPush?: (event: BrowserPushEvent) => void;
}

export class BrowserController {
  private window: BrowserWindow | null = null;
  private readonly browsers = new Map<BrowserId, BrowserEntry>();
  private onPush: BrowserControllerOptions["onPush"];

  constructor(opts: BrowserControllerOptions = {}) {
    this.onPush = opts.onPush;
  }

  /** Attach the host window. Must be called before any view is shown. */
  attach(window: BrowserWindow): void {
    this.window = window;
  }

  setOnPush(onPush: BrowserControllerOptions["onPush"]): void {
    this.onPush = onPush;
  }

  // -- Lifecycle ------------------------------------------------------------

  /** Create the view for `agentId` if it does not exist yet; returns it. */
  ensure(agentId: BrowserId): WebContentsView {
    const existing = this.browsers.get(agentId);
    if (existing) return existing.view;
    if (!this.window) throw new Error("BrowserController: no host window attached");

    const partition = `persist:agent-${agentId}`;
    const sess = session.fromPartition(partition, { cache: true });
    this.hardenSession(sess);

    const view = new WebContentsView({
      webPreferences: {
        session: sess,
        // A clean, sandboxed, isolated context — this is a *verified page*,
        // not harness UI, so it gets no preload and full web security.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    view.setBackgroundColor("#ffffff");

    const entry: BrowserEntry = {
      view,
      session: sess,
      partition,
      console: new Ring<ConsoleMessage>(),
      network: new Ring<NetworkRequest>(),
      lastAction: null,
      visible: false,
    };
    this.browsers.set(agentId, entry);

    this.wireWebContents(agentId, entry);
    this.wireNetwork(entry, sess);

    // Native layer above the renderer DOM. Starts hidden until positioned.
    this.window.contentView.addChildView(view);
    view.setVisible(false);
    return view;
  }

  get(agentId: BrowserId): WebContentsView | null {
    return this.browsers.get(agentId)?.view ?? null;
  }

  /** Tear down the view and erase its session storage. */
  async destroy(agentId: BrowserId): Promise<void> {
    const entry = this.browsers.get(agentId);
    if (!entry) return;
    this.browsers.delete(agentId);
    try {
      this.window?.contentView.removeChildView(entry.view);
    } catch {
      // window may already be gone during shutdown
    }
    try {
      // `webContents.close()` (vs deprecated `destroy()`) on the view.
      entry.view.webContents.close();
    } catch {
      // already closed
    }
    try {
      await entry.session.clearStorageData();
    } catch {
      // best-effort: the partition disappears with the user data dir anyway
    }
  }

  /** Destroy every browser (called on app quit). */
  async destroyAll(): Promise<void> {
    await Promise.all([...this.browsers.keys()].map((id) => this.destroy(id)));
  }

  /**
   * Forget all in-memory views without clearing storage — used when the host
   * window closes. The native views are destroyed with the window, so the refs
   * are dead, but the persistent partitions must survive (sessions persist
   * across window recreation and app restarts; storage is only cleared on agent
   * termination via `destroy`).
   */
  detachWindow(): void {
    this.browsers.clear();
    this.window = null;
  }

  // -- Positioning ----------------------------------------------------------

  /**
   * Place the view over the renderer's placeholder. The renderer reports a
   * CSS-pixel rect relative to the top-left of its web contents, which equals
   * the window content area (the renderer fills it), so the rect maps directly
   * to `setBounds`. A zero-area rect hides the view.
   */
  positionFor(agentId: BrowserId, rect: BrowserRect): void {
    const entry = this.browsers.get(agentId);
    if (!entry) return;
    if (rect.width <= 0 || rect.height <= 0) {
      this.hide(agentId);
      return;
    }
    entry.view.setBounds({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    if (!entry.visible) {
      entry.visible = true;
      entry.view.setVisible(true);
    }
  }

  hide(agentId: BrowserId): void {
    const entry = this.browsers.get(agentId);
    if (!entry || !entry.visible) return;
    entry.visible = false;
    entry.view.setVisible(false);
  }

  // -- Navigation -----------------------------------------------------------

  async navigate(agentId: BrowserId, rawUrl: string): Promise<BrowserState> {
    const view = this.ensure(agentId);
    const url = SCHEME_RE.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    this.setLastAction(agentId, `navigate ${hostOf(url)}`);
    this.emitAction(agentId, { type: "navigate", url });
    try {
      await view.webContents.loadURL(url);
    } catch {
      // Aborted loads / sub-frame errors reject loadURL but the main frame may
      // still have committed; surface whatever state we have rather than throw.
    }
    return this.snapshotState(agentId);
  }

  back(agentId: BrowserId): BrowserState {
    const view = this.get(agentId);
    if (view && view.webContents.navigationHistory.canGoBack()) {
      view.webContents.navigationHistory.goBack();
      this.setLastAction(agentId, "back");
    }
    return this.snapshotState(agentId);
  }

  forward(agentId: BrowserId): BrowserState {
    const view = this.get(agentId);
    if (view && view.webContents.navigationHistory.canGoForward()) {
      view.webContents.navigationHistory.goForward();
      this.setLastAction(agentId, "forward");
    }
    return this.snapshotState(agentId);
  }

  reload(agentId: BrowserId): BrowserState {
    const view = this.get(agentId);
    if (view) {
      view.webContents.reload();
      this.setLastAction(agentId, "reload");
    }
    return this.snapshotState(agentId);
  }

  stop(agentId: BrowserId): BrowserState {
    const view = this.get(agentId);
    if (view) {
      view.webContents.stop();
      this.setLastAction(agentId, "stop");
    }
    return this.snapshotState(agentId);
  }

  // -- State + buffers ------------------------------------------------------

  snapshotState(agentId: BrowserId): BrowserState {
    const entry = this.browsers.get(agentId);
    if (!entry) {
      return {
        agentId,
        exists: false,
        url: "",
        title: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        lastAction: null,
      };
    }
    const wc = entry.view.webContents;
    return {
      agentId,
      exists: true,
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoadingMainFrame(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      lastAction: entry.lastAction,
    };
  }

  consoleMessages(agentId: BrowserId, since?: number): ConsoleMessage[] {
    return this.browsers.get(agentId)?.console.since(since) ?? [];
  }

  networkRequests(agentId: BrowserId, since?: number): NetworkRequest[] {
    return this.browsers.get(agentId)?.network.since(since) ?? [];
  }

  // -- internals ------------------------------------------------------------

  private setLastAction(agentId: BrowserId, action: string): void {
    const entry = this.browsers.get(agentId);
    if (entry) entry.lastAction = action;
  }

  private emitState(agentId: BrowserId): void {
    this.onPush?.({ kind: "state", agentId, state: this.snapshotState(agentId) });
  }

  private emitAction(agentId: BrowserId, action: BrowserActionEvent): void {
    this.onPush?.({ kind: "action", agentId, action });
  }

  private hardenSession(sess: Session): void {
    // Deny camera / mic / geolocation / notifications etc. (spec §10).
    sess.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    sess.setPermissionCheckHandler(() => false);
    // Block downloads for v1 (documented limitation).
    sess.on("will-download", (event) => event.preventDefault());
  }

  private wireWebContents(agentId: BrowserId, entry: BrowserEntry): void {
    const wc: WebContents = entry.view.webContents;

    // Single-tab: keep target=_blank / window.open in the same view.
    wc.setWindowOpenHandler(({ url }) => {
      void wc.loadURL(url);
      return { action: "deny" };
    });

    const pushState = (): void => this.emitState(agentId);
    wc.on("did-start-loading", pushState);
    wc.on("did-stop-loading", pushState);
    wc.on("did-navigate", pushState);
    wc.on("did-navigate-in-page", pushState);
    wc.on("page-title-updated", pushState);

    wc.on(
      "console-message",
      (_event: Electron.Event, level: number, message: string, line: number, _sourceId: string) => {
        entry.console.push((seq) => ({
          seq,
          level: consoleLevelFromChromium(level),
          text: message,
          lineNumber: line,
          at: new Date().toISOString(),
        }));
      },
    );
  }

  private wireNetwork(entry: BrowserEntry, sess: Session): void {
    // Per-session request accounting. Each agent has its own partition, so
    // these listeners are scoped to that agent's traffic only.
    sess.webRequest.onCompleted((details) => {
      entry.network.push((seq) => {
        const item: NetworkRequest = {
          seq,
          url: details.url,
          method: details.method,
          at: new Date().toISOString(),
        };
        if (details.statusCode !== undefined) item.statusCode = details.statusCode;
        if (details.resourceType !== undefined) item.resourceType = details.resourceType;
        if (details.fromCache !== undefined) item.fromCache = details.fromCache;
        return item;
      });
    });
  }
}
