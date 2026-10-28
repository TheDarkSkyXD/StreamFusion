import { BrowserWindow, type IpcMainInvokeEvent, type Rectangle } from "electron";

import { trustedIpcMain as ipcMain } from "@backend/ipc/trusted-ipc-main";

import {
  DEVELOPER_WIDGET_FRAME,
  parseDeveloperWidgetLayout,
  shapeFromDeveloperWidgetLayout,
  type DeveloperWidgetLayout,
} from "../../../../../shared/developer-widget-layout";
import { IPC_CHANNELS } from "../../../../../shared/ipc-channels";

export function createDeveloperWidgetOverlay(owner: BrowserWindow, enabled: boolean) {
  if (!enabled) {
    return {
      handleOpen: (_details: { url: string; frameName: string; features: string }) => null,
      dispose: () => undefined,
    };
  }
  const ownerContents = owner.webContents;
  let popup: BrowserWindow | null = null;
  let armed = false;
  let pending = false;
  let revision = -1;
  let shape: Rectangle[] = [];
  let currentLayout: DeveloperWidgetLayout | null = null;
  let lastBounds: Rectangle | null = null;
  let lastZoom = Number.NaN;
  let shown = false;

  const trusted = (event: IpcMainInvokeEvent): boolean =>
    enabled &&
    !owner.isDestroyed() &&
    event.sender === ownerContents &&
    event.senderFrame === ownerContents.mainFrame;
  const viewport = () => {
    const bounds = owner.getContentBounds();
    const zoom = ownerContents.getZoomFactor();
    return { width: bounds.width / zoom, height: bounds.height / zoom };
  };
  const syncVisibility = (): void => {
    if (!popup || popup.isDestroyed()) return;
    const shouldShow = shape.length > 0 && owner.isVisible() && !owner.isMinimized();
    if (shouldShow === shown) return;
    if (shouldShow) popup.showInactive();
    else popup.hide();
    shown = shouldShow;
  };
  const syncBounds = (): void => {
    if (!popup || popup.isDestroyed()) return;
    const bounds = owner.getContentBounds();
    const zoom = ownerContents.getZoomFactor();
    const viewportChanged =
      !lastBounds ||
      bounds.width !== lastBounds.width ||
      bounds.height !== lastBounds.height ||
      zoom !== lastZoom;
    if (!lastBounds || bounds.x !== lastBounds.x || bounds.y !== lastBounds.y || viewportChanged) {
      popup.setContentBounds(bounds);
      lastBounds = bounds;
    }
    if (zoom !== lastZoom) {
      popup.webContents.setZoomFactor(zoom);
      lastZoom = zoom;
    }
    if (currentLayout && viewportChanged) {
      const cssViewport = { width: bounds.width / zoom, height: bounds.height / zoom };
      const clipped = {
        ...currentLayout,
        rectsCss: currentLayout.rectsCss.filter(
          (rect) => rect.x < cssViewport.width && rect.y < cssViewport.height
        ),
      };
      try {
        shape = shapeFromDeveloperWidgetLayout(clipped, cssViewport, zoom);
        popup.setShape(shape);
      } catch {
        popup.hide();
        shown = false;
        return;
      }
    }
    syncVisibility();
  };
  const close = (): void => {
    if (popup && !popup.isDestroyed()) popup.close();
    popup = null;
    armed = false;
    pending = false;
    revision = -1;
    shape = [];
    currentLayout = null;
    lastBounds = null;
    lastZoom = Number.NaN;
    shown = false;
  };

  ipcMain.handle(IPC_CHANNELS.DEVELOPER_WIDGET_ARM, (event) => {
    if (!trusted(event) || popup || pending) return false;
    armed = true;
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.DEVELOPER_WIDGET_LAYOUT, (event, raw: unknown) => {
    if (!trusted(event) || !popup || popup.isDestroyed()) return { applied: false, revision };
    const bounds = viewport();
    const layout = parseDeveloperWidgetLayout(raw, bounds);
    if (!layout || layout.revision <= revision) return { applied: false, revision };
    const nextShape = shapeFromDeveloperWidgetLayout(layout, bounds, ownerContents.getZoomFactor());
    try {
      popup.setShape(nextShape);
    } catch {
      return { applied: false, revision };
    }
    revision = layout.revision;
    shape = nextShape;
    currentLayout = layout;
    syncVisibility();
    return { applied: true, revision };
  });
  ipcMain.handle(IPC_CHANNELS.DEVELOPER_WIDGET_CLOSE, (event) => {
    if (trusted(event)) close();
  });

  owner.on("move", syncBounds);
  owner.on("resize", syncBounds);
  owner.on("maximize", syncBounds);
  owner.on("unmaximize", syncBounds);
  owner.on("restore", syncBounds);
  owner.on("show", syncVisibility);
  owner.on("hide", syncVisibility);
  owner.on("minimize", syncVisibility);
  owner.on("enter-full-screen", syncBounds);
  owner.on("leave-full-screen", syncBounds);
  const closeForDocumentNavigation = (details: {
    isMainFrame: boolean;
    isSameDocument: boolean;
  }) => {
    if (details.isMainFrame && !details.isSameDocument) close();
  };
  ownerContents.on("render-process-gone", close);
  ownerContents.on("did-start-navigation", closeForDocumentNavigation);
  ownerContents.on("zoom-changed", syncBounds);
  ownerContents.on("did-create-window", (created, details) => {
    if (!pending || details.url !== "about:blank" || details.frameName !== DEVELOPER_WIDGET_FRAME) {
      created.close();
      return;
    }
    pending = false;
    popup = created;
    revision = -1;
    shape = [];
    currentLayout = null;
    lastBounds = null;
    lastZoom = Number.NaN;
    shown = false;
    const popupContents = created.webContents;
    popupContents.setWindowOpenHandler(() => ({ action: "deny" }));
    popupContents.on("will-navigate", (event) => event.preventDefault());
    const session = popupContents.session;
    const denyDownload = (
      event: Electron.Event,
      _item: Electron.DownloadItem,
      contents: Electron.WebContents
    ) => {
      if (contents === popupContents) event.preventDefault();
    };
    session.on("will-download", denyDownload);
    created.on("closed", () => {
      session.removeListener("will-download", denyDownload);
      if (popup === created) {
        popup = null;
        shape = [];
        currentLayout = null;
        lastBounds = null;
        lastZoom = Number.NaN;
        shown = false;
      }
    });
    syncBounds();
  });

  return {
    handleOpen(details: { url: string; frameName: string; features: string }) {
      if (
        !enabled ||
        !armed ||
        popup ||
        details.url !== "about:blank" ||
        details.frameName !== DEVELOPER_WIDGET_FRAME ||
        details.features !== ""
      )
        return null;
      armed = false;
      pending = true;
      return {
        action: "allow" as const,
        outlivesOpener: false,
        overrideBrowserWindowOptions: {
          parent: owner,
          transparent: true,
          frame: false,
          show: false,
          skipTaskbar: true,
          hasShadow: false,
          resizable: false,
          fullscreenable: false,
          backgroundColor: "#00000000",
          webPreferences: { sandbox: false, nodeIntegration: false, contextIsolation: true },
        },
      };
    },
    dispose() {
      close();
      owner.removeListener("move", syncBounds);
      owner.removeListener("resize", syncBounds);
      owner.removeListener("maximize", syncBounds);
      owner.removeListener("unmaximize", syncBounds);
      owner.removeListener("restore", syncBounds);
      owner.removeListener("show", syncVisibility);
      owner.removeListener("hide", syncVisibility);
      owner.removeListener("minimize", syncVisibility);
      owner.removeListener("enter-full-screen", syncBounds);
      owner.removeListener("leave-full-screen", syncBounds);
      ownerContents.removeListener("render-process-gone", close);
      ownerContents.removeListener("did-start-navigation", closeForDocumentNavigation);
      ownerContents.removeListener("zoom-changed", syncBounds);
      for (const channel of [
        IPC_CHANNELS.DEVELOPER_WIDGET_ARM,
        IPC_CHANNELS.DEVELOPER_WIDGET_LAYOUT,
        IPC_CHANNELS.DEVELOPER_WIDGET_CLOSE,
      ])
        ipcMain.removeHandler(channel);
    },
  };
}
