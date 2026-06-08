/**
 * WebContentsView factory — the injectable seam between slot-controller and
 * Electron's real WCV constructor. Production returns a thin SlotView wrapper
 * around `new WebContentsView(...)`; tests inject a fake so the slot-controller
 * lifecycle can be tested without spinning up real Chromium.
 *
 * Slice 05 of the renderer-OOM PRD (#51, issue #56). See ADR-0003 for the
 * security posture pinned in webPreferences.
 */

import { WebContentsView } from "electron";

/**
 * The slot-controller's view of a per-slot WCV. Narrow surface: just the
 * webContents handle (for IPC fan-out) and the lifecycle controls main needs
 * to drive from the React grid (rect, visibility, destroy).
 */
export interface SlotView {
  readonly webContents: Electron.WebContents;
  setBounds(rect: { x: number; y: number; width: number; height: number }): void;
  setVisible(visible: boolean): void;
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
