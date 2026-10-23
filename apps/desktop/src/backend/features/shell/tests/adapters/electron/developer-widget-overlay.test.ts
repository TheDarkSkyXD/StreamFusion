import { EventEmitter } from "node:events";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(
  () => new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>()
);
vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      callback: (event: IpcMainInvokeEvent, payload?: unknown) => unknown
    ) => handlers.set(channel, callback),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}));

import { createDeveloperWidgetOverlay } from "../../../adapters/electron/developer-widget-overlay";
import { IPC_CHANNELS } from "../../../../../../shared/ipc-channels";

function createWindow() {
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { url: "http://localhost:5173" },
    getZoomFactor: vi.fn(() => 1.5),
    setZoomFactor: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    session: new EventEmitter(),
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    getContentBounds: () => ({ x: 10, y: 20, width: 150, height: 150 }),
    setContentBounds: vi.fn(),
    setShape: vi.fn(),
    showInactive: vi.fn(),
    hide: vi.fn(),
    isVisible: () => true,
    isMinimized: vi.fn(() => false),
    isDestroyed: () => false,
    close: vi.fn(),
  });
  return { window, contents };
}

describe("developer widget overlay ownership", () => {
  beforeEach(() => handlers.clear());

  it("does not register widget IPC outside the supported development host", () => {
    const owner = createWindow();
    const overlay = createDeveloperWidgetOverlay(owner.window as unknown as BrowserWindow, false);
    expect(handlers.size).toBe(0);
    expect(
      overlay.handleOpen({
        url: "about:blank",
        frameName: "streamfusion-developer-widgets",
        features: "",
      })
    ).toBeNull();
    overlay.dispose();
  });

  it("opens only the armed blank owner popup and shapes positive rectangles before showing", () => {
    const owner = createWindow();
    const overlay = createDeveloperWidgetOverlay(owner.window as unknown as BrowserWindow, true);
    const arm = handlers.get(IPC_CHANNELS.DEVELOPER_WIDGET_ARM);
    const layout = handlers.get(IPC_CHANNELS.DEVELOPER_WIDGET_LAYOUT);
    if (!arm || !layout) throw new Error("Widget handlers missing");
    const trusted = {
      sender: owner.contents,
      senderFrame: owner.contents.mainFrame,
    } as unknown as IpcMainInvokeEvent;
    const childFrame = { sender: owner.contents, senderFrame: {} } as unknown as IpcMainInvokeEvent;
    expect(arm(childFrame)).toBe(false);
    expect(
      overlay.handleOpen({
        url: "about:blank",
        frameName: "streamfusion-developer-widgets",
        features: "",
      })
    ).toBeNull();
    expect(arm(trusted)).toBe(true);
    expect(
      overlay.handleOpen({
        url: "https://example.com",
        frameName: "streamfusion-developer-widgets",
        features: "",
      })
    ).toBeNull();
    expect(
      overlay.handleOpen({
        url: "about:blank",
        frameName: "streamfusion-developer-widgets",
        features: "width=100",
      })
    ).toBeNull();
    const allowed = overlay.handleOpen({
      url: "about:blank",
      frameName: "streamfusion-developer-widgets",
      features: "",
    });
    expect(allowed).toMatchObject({
      action: "allow",
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        transparent: true,
        skipTaskbar: true,
        webPreferences: { sandbox: false, nodeIntegration: false, contextIsolation: true },
      },
    });
    expect(
      overlay.handleOpen({
        url: "about:blank",
        frameName: "streamfusion-developer-widgets",
        features: "",
      })
    ).toBeNull();
    const popup = createWindow();
    owner.contents.emit("did-create-window", popup.window, {
      url: "about:blank",
      frameName: "streamfusion-developer-widgets",
    });
    expect(
      layout(trusted, { revision: 1, rectsCss: [{ x: 9.4, y: 10.2, width: 20.3, height: 30.1 }] })
    ).toEqual({ applied: true, revision: 1 });
    expect(popup.window.setShape).toHaveBeenCalledWith([{ x: 14, y: 15, width: 31, height: 46 }]);
    expect(popup.window.setShape).toHaveBeenCalledTimes(1);
    expect(popup.window.showInactive).toHaveBeenCalled();
    expect(popup.window.setContentBounds).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: 150,
      height: 150,
    });
    expect(popup.window.setContentBounds).toHaveBeenCalledTimes(1);
    expect(popup.contents.setZoomFactor).toHaveBeenCalledTimes(1);
    owner.contents.getZoomFactor.mockReturnValue(2);
    owner.contents.emit("zoom-changed");
    expect(popup.window.setShape).toHaveBeenLastCalledWith([
      { x: 18, y: 20, width: 42, height: 61 },
    ]);
    owner.window.isMinimized.mockReturnValue(true);
    owner.window.emit("minimize");
    expect(popup.window.hide).toHaveBeenCalled();
    expect(layout(trusted, { revision: 1, rectsCss: [] })).toEqual({ applied: false, revision: 1 });
    expect(layout(childFrame, { revision: 2, rectsCss: [] })).toEqual({
      applied: false,
      revision: 1,
    });
    owner.contents.emit("render-process-gone");
    expect(popup.window.close).toHaveBeenCalled();
    overlay.dispose();
  });

  it("keeps the popup on same-document and subframe navigation, then closes it for a full main-frame navigation", () => {
    const owner = createWindow();
    const overlay = createDeveloperWidgetOverlay(owner.window as unknown as BrowserWindow, true);
    const arm = handlers.get(IPC_CHANNELS.DEVELOPER_WIDGET_ARM);
    if (!arm) throw new Error("Widget arm handler missing");
    const trusted = {
      sender: owner.contents,
      senderFrame: owner.contents.mainFrame,
    } as unknown as IpcMainInvokeEvent;
    expect(arm(trusted)).toBe(true);
    expect(
      overlay.handleOpen({
        url: "about:blank",
        frameName: "streamfusion-developer-widgets",
        features: "",
      })?.action
    ).toBe("allow");
    const popup = createWindow();
    owner.contents.emit("did-create-window", popup.window, {
      url: "about:blank",
      frameName: "streamfusion-developer-widgets",
    });

    owner.contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    owner.contents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
    owner.contents.emit("did-start-loading");
    expect(popup.window.close).toHaveBeenCalledTimes(0);
    expect(arm(trusted)).toBe(false);

    owner.contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    expect(popup.window.close).toHaveBeenCalledTimes(1);
    expect(arm(trusted)).toBe(true);
    overlay.dispose();
  });

  it("accepts a stale fullscreen panel while the owner resizes", () => {
    const owner = createWindow();
    owner.contents.getZoomFactor.mockReturnValue(1);
    const overlay = createDeveloperWidgetOverlay(owner.window as unknown as BrowserWindow, true);
    const arm = handlers.get(IPC_CHANNELS.DEVELOPER_WIDGET_ARM);
    const layout = handlers.get(IPC_CHANNELS.DEVELOPER_WIDGET_LAYOUT);
    if (!arm || !layout) throw new Error("Widget handlers missing");
    const trusted = {
      sender: owner.contents,
      senderFrame: owner.contents.mainFrame,
    } as unknown as IpcMainInvokeEvent;
    const getContentBounds = vi.spyOn(owner.window, "getContentBounds").mockReturnValue({
      x: 10,
      y: 20,
      width: 1920,
      height: 1080,
    });
    expect(arm(trusted)).toBe(true);
    expect(
      overlay.handleOpen({
        url: "about:blank",
        frameName: "streamfusion-developer-widgets",
        features: "",
      })?.action
    ).toBe("allow");
    const popup = createWindow();
    owner.contents.emit("did-create-window", popup.window, {
      url: "about:blank",
      frameName: "streamfusion-developer-widgets",
    });
    expect(
      layout(trusted, {
        revision: 1,
        rectsCss: [{ x: 0, y: 0, width: 1920, height: 500 }],
      })
    ).toEqual({ applied: true, revision: 1 });
    getContentBounds.mockReturnValue({
      x: 10,
      y: 20,
      width: 1400,
      height: 900,
    });
    owner.window.emit("resize");

    expect(
      layout(trusted, {
        revision: 2,
        rectsCss: [{ x: 0, y: 0, width: 1920, height: 500 }],
      })
    ).toEqual({ applied: true, revision: 2 });
    expect(popup.window.setShape).toHaveBeenLastCalledWith([
      { x: 0, y: 0, width: 1400, height: 500 },
    ]);
    expect(popup.window.showInactive).toHaveBeenCalled();
    overlay.dispose();
  });

  it("disposes after the owner closes without reading its destroyed webContents", () => {
    const owner = createWindow();
    const overlay = createDeveloperWidgetOverlay(owner.window as unknown as BrowserWindow, true);
    Object.defineProperty(owner.window, "webContents", {
      get: () => {
        throw new Error("Destroyed owner webContents was accessed");
      },
    });
    expect(() => overlay.dispose()).not.toThrow();
    expect(owner.contents.listenerCount("did-start-navigation")).toBe(0);
  });
});
