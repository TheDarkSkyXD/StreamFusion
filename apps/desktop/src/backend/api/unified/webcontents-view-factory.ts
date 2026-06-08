/**
 * WebContentsView factory — the injectable seam between slot-controller and
 * Electron's real WCV constructor. Production returns a thin SlotView wrapper
 * around `new WebContentsView(...)`; tests inject a fake so the slot-controller
 * lifecycle can be tested without spinning up real Chromium.
 *
 * Slice 05 of the renderer-OOM PRD (#51, issue #56). See ADR-0003 for the
 * security posture pinned in webPreferences.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, WebContentsView } from "electron";

/**
 * The slot-controller's view of a per-slot WCV. Narrow surface: just the
 * webContents handle (for IPC fan-out) and the lifecycle controls main needs
 * to drive from the React grid (rect, visibility, destroy).
 */
/**
 * Details surfaced by Electron's `render-process-gone` event. Only the bits
 * the slot-controller's crash recovery actually needs.
 */
export interface SlotCrashDetails {
  reason: string;
  exitCode?: number;
}

export interface SlotView {
  readonly webContents: Electron.WebContents;
  setBounds(rect: { x: number; y: number; width: number; height: number }): void;
  setVisible(visible: boolean): void;
  /**
   * Load a URL into the WCV. Production: pass the slot-renderer file URL
   * (or dev-server URL in dev mode). Tests: fakes record the call.
   * Returns a Promise that resolves when the page emits dom-ready (mirrors
   * Electron's `WebContents.loadURL` contract).
   */
  loadURL(url: string): Promise<void>;
  /**
   * Subscribe to the WCV's `render-process-gone` event. Returns an
   * unsubscribe handle. Slice 06 of the renderer-OOM PRD wires this into
   * the slot-controller's crash recovery policy. Tests inject a fake
   * SlotView that exposes a trigger helper.
   */
  onRenderProcessGone(callback: (details: SlotCrashDetails) => void): () => void;
  destroy(): void;
}

export interface WebContentsViewFactoryCreateOpts {
  /**
   * Absolute path to the slot's narrow preload bundle. Wired into
   * `webPreferences.preload` so the WCV exposes ONLY the slot IPC surface
   * (not the full electronAPI).
   */
  preloadPath?: string;
}

export interface WebContentsViewFactory {
  create(opts: WebContentsViewFactoryCreateOpts): SlotView;
}

/**
 * Build a production WebContentsView factory. The factory locks the security
 * posture (sandbox + contextIsolation + nodeIntegration:false per ADR-0003)
 * so every slot WCV inherits the same hardened configuration.
 */
export function createDefaultWebContentsViewFactory(): WebContentsViewFactory {
  return {
    create: ({ preloadPath }) => {
      const webPreferences: Electron.WebPreferences = {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        ...(preloadPath ? { preload: preloadPath } : {}),
      };
      const view = new WebContentsView({ webPreferences });
      return {
        get webContents(): Electron.WebContents {
          return view.webContents;
        },
        setBounds: (rect) => view.setBounds(rect),
        setVisible: (visible) => view.setVisible(visible),
        loadURL: (url) => view.webContents.loadURL(url),
        onRenderProcessGone: (callback) => {
          const handler = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
            callback({ reason: details.reason, exitCode: details.exitCode });
          };
          view.webContents.on("render-process-gone", handler);
          return () => view.webContents.off("render-process-gone", handler);
        },
        destroy: () => {
          if (!view.webContents.isDestroyed()) {
            view.webContents.close();
          }
        },
      };
    },
  };
}

let activeFactory: WebContentsViewFactory = createDefaultWebContentsViewFactory();

export function getWebContentsViewFactory(): WebContentsViewFactory {
  return activeFactory;
}

export function setWebContentsViewFactory(factory: WebContentsViewFactory): void {
  activeFactory = factory;
}

export function __resetWebContentsViewFactoryForTests(): void {
  activeFactory = createDefaultWebContentsViewFactory();
}

/**
 * Resolve the URL the slot WCV should load to host its video player.
 *
 * - Dev (electron-vite serves the renderer): `${ELECTRON_RENDERER_URL}/src/slot-renderer/index.html`
 * - Prod (packaged): file:// URL into the built `out/renderer/src/slot-renderer/index.html`
 *
 * Mirrors the window-manager pattern that loads the main BrowserWindow URL.
 * Pure for testability — main injects `app` and `__dirname`-equivalent at
 * call time via the env / Electron's app object.
 */
export function getSlotRendererUrl(): string {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return `${process.env.ELECTRON_RENDERER_URL}/src/slot-renderer/index.html`;
  }
  // In packaged builds the main module bundle lives next to the renderer
  // output: app.getAppPath() points at `app.asar/`, and electron-vite's
  // default output layout puts the renderer at `out/renderer/<entry>.html`
  // with multi-input HTMLs preserved at their relative source path. The
  // slot-renderer's entry maps to `out/renderer/src/slot-renderer/index.html`.
  const htmlPath = path.join(
    app.getAppPath(),
    "out",
    "renderer",
    "src",
    "slot-renderer",
    "index.html"
  );
  return pathToFileURL(htmlPath).toString();
}

/**
 * Resolve the absolute path to the built slot preload bundle so the factory
 * can inject it into `webPreferences.preload`. Dev/prod parity: electron-vite
 * emits the preload bundle to `out/preload/slot.js` in both modes.
 */
export function getSlotPreloadPath(): string {
  return path.join(app.getAppPath(), "out", "preload", "slot.js");
}

// Re-export for tests to spy at the call site if they need to. Kept here so
// the factory + URL helpers share one ESM module surface.
export const __testInternals = { fileURLToPath };
