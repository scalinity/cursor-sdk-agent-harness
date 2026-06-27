import {
  WebContentsView,
  session,
  app,
  type BrowserWindow,
  type Session,
  type WebContents,
} from "electron";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  AccessibilityNode,
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
const SAFE_SCHEMES = new Set(["http:", "https:"]);

/** Best-effort host extraction for status-strip / last-action labels. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Map Chromium's numeric console level to our ConsoleLevel enum. */
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
    try {
      const parsed = new URL(url);
      if (!SAFE_SCHEMES.has(parsed.protocol)) {
        throw new Error(`Scheme "${parsed.protocol}" is not allowed — only http: and https: are permitted.`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("not allowed")) throw err;
      throw new Error(`Invalid URL: ${rawUrl}`);
    }
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

  // -- Agent-only programmatic actions (Phase 18 M2) --------------------------

  private requireWc(agentId: BrowserId): WebContents {
    const view = this.get(agentId);
    if (!view) throw new Error(`No browser session for agent ${agentId} — navigate first.`);
    return view.webContents;
  }

  /**
   * Defense-in-depth: refs generated by snapshot() are always `e<number>`.
   * Reject anything else to prevent JS injection via executeJavaScript
   * string interpolation (review finding CA1-C1 / DB1-W1).
   */
  private assertSafeRef(ref: string): void {
    if (!/^e\d+$/.test(ref)) {
      throw new Error(`Invalid element ref "${ref}" — must match /^e\\d+$/ from a prior snapshot.`);
    }
  }

  /**
   * Capture the page's accessibility tree. Assigns sequential `data-aria-ref`
   * attributes to interactable elements so `click`/`type` can reference them.
   */
  async snapshot(agentId: BrowserId): Promise<{ tree: AccessibilityNode[]; url: string; title: string }> {
    const wc = this.requireWc(agentId);
    const tree: AccessibilityNode[] = await wc.executeJavaScript(`
      (function(){
        const R={'A':'link','BUTTON':'button','INPUT':'textbox','SELECT':'combobox',
          'TEXTAREA':'textbox','IMG':'img','H1':'heading','H2':'heading','H3':'heading',
          'H4':'heading','TABLE':'table','FORM':'form','NAV':'navigation','MAIN':'main',
          'HEADER':'banner','FOOTER':'contentinfo','SECTION':'region','ARTICLE':'article',
          'UL':'list','OL':'list','LI':'listitem'};
        let seq=0;
        function walk(el){
          if(!el||!el.tagName)return null;
          const tag=el.tagName;
          const role=el.getAttribute('role')||R[tag]||(tag==='DIV'||tag==='SPAN'?'':'generic');
          const ref='e'+(++seq);
          el.setAttribute('data-aria-ref',ref);
          const node={ref:ref,role:role||'generic'};
          const nm=el.getAttribute('aria-label')||el.getAttribute('alt')||
            el.getAttribute('title')||(tag==='INPUT'?el.getAttribute('placeholder'):null)||
            (el.innerText&&el.innerText.length<80?el.innerText.trim():null);
          if(nm)node.name=nm;
          if(el.value!==undefined&&el.value!=='')node.value=String(el.value);
          const ch=[];
          for(const c of el.children){const n=walk(c);if(n)ch.push(n);}
          if(ch.length)node.children=ch;
          return node;
        }
        const root=walk(document.body);
        return root&&root.children?root.children:[root].filter(Boolean);
      })()
    `);
    return { tree: tree ?? [], url: wc.getURL(), title: wc.getTitle() };
  }

  /** Click an element by its `data-aria-ref` from a prior snapshot. */
  async click(agentId: BrowserId, ref: string): Promise<{ clicked: true; urlAfter: string; ms: number }> {
    this.assertSafeRef(ref);
    const wc = this.requireWc(agentId);
    const start = Date.now();
    const found: boolean = await wc.executeJavaScript(
      `(function(){const el=document.querySelector('[data-aria-ref="${ref}"]');if(!el)return false;el.click();return true;})()`
    );
    if (!found) throw new Error(`Element ref "${ref}" not found — call browser_snapshot first.`);
    this.setLastAction(agentId, `click ${ref}`);
    this.emitAction(agentId, { type: "click", ref, rect: { x: 0, y: 0, width: 0, height: 0 } });
    // Brief wait for navigation/state changes triggered by the click
    await new Promise((r) => setTimeout(r, 100));
    return { clicked: true, urlAfter: wc.getURL(), ms: Date.now() - start };
  }

  /** Type text into an input by its `data-aria-ref`. Set submit=true to press Enter. */
  async type(agentId: BrowserId, ref: string, text: string, submit?: boolean): Promise<{ typed: true; valueAfter: string }> {
    this.assertSafeRef(ref);
    const wc = this.requireWc(agentId);
    const result: { ok: boolean; value: string } = await wc.executeJavaScript(
      `(function(){
        const el=document.querySelector('[data-aria-ref="${ref}"]');
        if(!el)return {ok:false,value:''};
        el.focus();
        el.value=${JSON.stringify(text)};
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
        ${submit ? "el.form?el.form.submit():el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));" : ""}
        return {ok:true,value:el.value};
      })()`
    );
    if (!result.ok) throw new Error(`Element ref "${ref}" not found — call browser_snapshot first.`);
    this.setLastAction(agentId, `type ${ref}`);
    this.emitAction(agentId, { type: "type", ref, rect: { x: 0, y: 0, width: 0, height: 0 } });
    return { typed: true, valueAfter: result.value };
  }

  /** Capture a PNG screenshot of the current viewport. */
  async screenshot(agentId: BrowserId, fullPage?: boolean): Promise<{ imagePath: string; width: number; height: number; bytes: number }> {
    const wc = this.requireWc(agentId);
    void fullPage; // v1: viewport only (fullPage requires scroll+stitch)
    const image = await wc.capturePage();
    const png = image.toPNG();
    const size = image.getSize();
    const dir = join(app.getPath("userData"), "screenshots", agentId);
    mkdirSync(dir, { recursive: true });
    const filename = `${Date.now()}.png`;
    const filePath = join(dir, filename);
    writeFileSync(filePath, png);
    this.setLastAction(agentId, "screenshot");
    this.emitAction(agentId, { type: "screenshot" });
    return { imagePath: filePath, width: size.width, height: size.height, bytes: png.length };
  }

  /** Evaluate a JS expression in the page. document.cookie reads are redacted (CA1-C2 fix). */
  async evaluate(agentId: BrowserId, expression: string): Promise<{ value: unknown; error?: string }> {
    const wc = this.requireWc(agentId);
    try {
      const value: unknown = await wc.executeJavaScript(
        `(function(){
          const __origCookie__ = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
          Object.defineProperty(document, 'cookie', {
            get() { return '[REDACTED]'; },
            set(v) { if (__origCookie__ && __origCookie__.set) __origCookie__.set.call(this, v); },
            configurable: true,
          });
          try {
            return (${expression});
          } finally {
            if (__origCookie__) Object.defineProperty(document, 'cookie', __origCookie__);
            else delete document.cookie;
          }
        })()`
      );
      return { value };
    } catch (err: unknown) {
      return { value: undefined, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Wait until a condition holds (text visible, ref exists, or fixed delay). */
  async waitFor(
    agentId: BrowserId,
    opts: { text?: string; ref?: string; ms?: number; timeoutMs?: number },
  ): Promise<{ matched: boolean; ms: number }> {
    if (opts.text === undefined && opts.ref === undefined && opts.ms === undefined) {
      throw new Error("browser_wait_for requires at least one of: text, ref, ms");
    }
    if (opts.ref !== undefined) this.assertSafeRef(opts.ref);
    const wc = this.requireWc(agentId);
    const timeout = opts.timeoutMs ?? 30_000;
    const start = Date.now();

    if (opts.ms !== undefined) {
      await new Promise((r) => setTimeout(r, Math.min(opts.ms!, timeout)));
      return { matched: true, ms: Date.now() - start };
    }

    const poll = async (): Promise<boolean> => {
      if (opts.text) {
        return wc.executeJavaScript(
          `document.body.innerText.includes(${JSON.stringify(opts.text)})`
        );
      }
      if (opts.ref) {
        return wc.executeJavaScript(
          `!!document.querySelector('[data-aria-ref="${opts.ref}"]')`
        );
      }
      return true;
    };

    while (Date.now() - start < timeout) {
      if (await poll()) return { matched: true, ms: Date.now() - start };
      await new Promise((r) => setTimeout(r, 200));
    }
    return { matched: false, ms: Date.now() - start };
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
    // Block dangerous schemes (file://, javascript:, etc.) per CA1-W4.
    wc.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url);
        if (SAFE_SCHEMES.has(parsed.protocol)) void wc.loadURL(url);
      } catch { /* reject malformed URLs */ }
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
