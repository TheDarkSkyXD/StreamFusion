import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

// Mock electron BEFORE importing the handler (matches platform-health-handlers.test.ts).
// `app` + `WebContentsView` are pulled in transitively by webcontents-view-factory,
// which slot-controller now imports for the slot-renderer URL/preload helpers.
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: {
    isPackaged: false,
    getAppPath: () => "/test/app",
  },
  WebContentsView: class FakeWebContentsView {
    webContents = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      loadURL: vi.fn(),
    };
    setBounds = vi.fn();
    setVisible = vi.fn();
  },
}));

import { ipcMain } from "electron";

import {
  __resetSlotControllerForTests,
  createSlot,
  dispatchLoadStream,
  getFocusedSlotId,
  getSlotPresence,
  setSlotPresence,
  setUseWebContentsViews,
} from "@/backend/api/unified/slot-controller";
import {
  __resetWebContentsViewFactoryForTests,
  setWebContentsViewFactory,
} from "@/backend/api/unified/webcontents-view-factory";
import { registerSlotControllerHandlers } from "@/backend/ipc/handlers/slot-controller-handlers";

type InvokeHandler = (event: unknown, args?: unknown) => unknown;

function getInvokeHandler(channel: string): InvokeHandler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, InvokeHandler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`invoke handler not registered: ${channel}`);
  return call[1];
}

function makeFakeMainWindow() {
  const send = vi.fn();
  return {
    window: {
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send,
      },
    },
    send,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetSlotControllerForTests();
  __resetWebContentsViewFactoryForTests();
});

// Guards: slot-controller IPC bridge — host→main channels mutate the controller,
// main→slot dispatch events are forwarded over webContents.send, and slot
// presence transitions push notifications to the host. Wires the slice-04
// IPC contract spelled out in PRD #51 → issue #55.

describe("registerSlotControllerHandlers — host → main channels", () => {
  it("registers invoke handlers for SLOT_REQUEST_FOCUS, SLOT_SET_MULTIVIEW_CAP, SLOT_SET_BACKGROUND_QUALITY, SLOT_REBIND_EXISTING_SLOTS", () => {
    const { window } = makeFakeMainWindow();
    registerSlotControllerHandlers(window as unknown as Electron.BrowserWindow);
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toEqual(
      expect.arrayContaining([
        IPC_CHANNELS.SLOT_REQUEST_FOCUS,
        IPC_CHANNELS.SLOT_SET_MULTIVIEW_CAP,
        IPC_CHANNELS.SLOT_SET_BACKGROUND_QUALITY,
        IPC_CHANNELS.SLOT_REBIND_EXISTING_SLOTS,
      ])
    );
  });

  it("SLOT_REQUEST_FOCUS promotes the given slot via the controller", async () => {
    const { window } = makeFakeMainWindow();
    registerSlotControllerHandlers(window as unknown as Electron.BrowserWindow);
    createSlot("slot-a");
    createSlot("slot-b");
    expect(getFocusedSlotId()).toBe("slot-a");

    const handler = getInvokeHandler(IPC_CHANNELS.SLOT_REQUEST_FOCUS);
    await handler({}, { slotId: "slot-b" });

    expect(getFocusedSlotId()).toBe("slot-b");
    expect(getSlotPresence("slot-a")).toBe("background");
  });

  it("SLOT_SET_MULTIVIEW_CAP raises the cap so subsequent creates pass", async () => {
    const { window } = makeFakeMainWindow();
    registerSlotControllerHandlers(window as unknown as Electron.BrowserWindow);

    // Lower cap, fill it.
    const handler = getInvokeHandler(IPC_CHANNELS.SLOT_SET_MULTIVIEW_CAP);
    await handler({}, { cap: 1 });
    createSlot("slot-1");
    createSlot("slot-2");
    expect(getSlotPresence("slot-2")).toBeUndefined();

    // Raise the cap.
    await handler({}, { cap: 3 });
    createSlot("slot-2");
    expect(getSlotPresence("slot-2")).toBe("background");
  });

  it("SLOT_SET_BACKGROUND_QUALITY accepts the persisted-quality mode without throwing (slice 08 reads the persisted value; slice 04 just acknowledges)", () => {
    const { window } = makeFakeMainWindow();
    registerSlotControllerHandlers(window as unknown as Electron.BrowserWindow);

    const handler = getInvokeHandler(IPC_CHANNELS.SLOT_SET_BACKGROUND_QUALITY);
    expect(() => handler({}, { mode: "auto-low" })).not.toThrow();
    expect(() => handler({}, { mode: "match-source" })).not.toThrow();
    expect(() => handler({}, { mode: "off" })).not.toThrow();
  });
});

describe("registerSlotControllerHandlers — main → renderer dispatch fan-out", () => {
  it("forwards slot-controller load-stream events to webContents.send on SLOT_LOAD_STREAM", () => {
    const { window, send } = makeFakeMainWindow();
    registerSlotControllerHandlers(window as unknown as Electron.BrowserWindow);

    createSlot("slot-1");
    dispatchLoadStream("slot-1", { platform: "kick", channelName: "xqc" });

    const loadCalls = send.mock.calls.filter(([ch]) => ch === IPC_CHANNELS.SLOT_LOAD_STREAM);
    expect(loadCalls).toHaveLength(1);
    expect(loadCalls[0][1]).toMatchObject({
      slotId: "slot-1",
      payload: { platform: "kick", channelName: "xqc" },
    });
  });

  it("forwards presence-changed events to webContents.send on SLOT_PRESENCE_CHANGED", () => {
    const { window, send } = makeFakeMainWindow();
    registerSlotControllerHandlers(window as unknown as Electron.BrowserWindow);

    createSlot("slot-1");
    createSlot("slot-2");
    setSlotPresence("slot-2", "focused");

    const presenceCalls = send.mock.calls.filter(([ch]) => ch === IPC_CHANNELS.SLOT_PRESENCE_CHANGED);
    // Two pushes: slot-1 → background, slot-2 → focused.
    expect(presenceCalls).toHaveLength(2);
  });

  it("does not push to a destroyed window", () => {
    const { window, send } = makeFakeMainWindow();
    vi.mocked(window.isDestroyed).mockReturnValue(true);
    registerSlotControllerHandlers(window as unknown as Electron.BrowserWindow);

    createSlot("slot-1");
    dispatchLoadStream("slot-1", { platform: "kick", channelName: "xqc" });

    expect(send).not.toHaveBeenCalled();
  });
});

describe("registerSlotControllerHandlers — slot-05 dispatch routing", () => {
  it("routes dispatch events to the slot's WebContentsView when the WCV flag is on", () => {
    const { window, send } = makeFakeMainWindow();
    registerSlotControllerHandlers(window as unknown as Electron.BrowserWindow);

    // Inject a fake WCV factory + flip the flag, then create slot 1 so it
    // gets a view.
    const viewSend = vi.fn();
    const viewWebContents = {
      send: viewSend,
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
    } as unknown as Electron.WebContents;
    setWebContentsViewFactory({
      create: () => ({
        webContents: viewWebContents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        loadURL: vi.fn(async () => {}),
        onRenderProcessGone: vi.fn(() => () => {}),
        destroy: vi.fn(),
      }),
    });
    setUseWebContentsViews(true);
    createSlot("slot-1");

    dispatchLoadStream("slot-1", { platform: "kick", channelName: "xqc" });

    // The dispatch landed on the slot's WCV — NOT on the main window.
    expect(viewSend).toHaveBeenCalledWith(
      IPC_CHANNELS.SLOT_LOAD_STREAM,
      expect.objectContaining({
        type: "load-stream",
        slotId: "slot-1",
        payload: { platform: "kick", channelName: "xqc" },
      })
    );
    const dispatchCallsOnMain = send.mock.calls.filter(
      ([ch]) => ch === IPC_CHANNELS.SLOT_LOAD_STREAM
    );
    expect(dispatchCallsOnMain).toHaveLength(0);
  });

  it("presence-changed always goes to the host (slot chrome lives there, never the WCV)", () => {
    const { window, send } = makeFakeMainWindow();
    registerSlotControllerHandlers(window as unknown as Electron.BrowserWindow);

    const viewSend = vi.fn();
    setWebContentsViewFactory({
      create: () => ({
        webContents: {
          send: viewSend,
          isDestroyed: vi.fn(() => false),
          close: vi.fn(),
        } as unknown as Electron.WebContents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        loadURL: vi.fn(async () => {}),
        onRenderProcessGone: vi.fn(() => () => {}),
        destroy: vi.fn(),
      }),
    });
    setUseWebContentsViews(true);
    createSlot("slot-1");
    createSlot("slot-2");

    setSlotPresence("slot-2", "focused");

    const presenceCallsOnMain = send.mock.calls.filter(
      ([ch]) => ch === IPC_CHANNELS.SLOT_PRESENCE_CHANGED
    );
    expect(presenceCallsOnMain.length).toBeGreaterThan(0);

    const presenceCallsOnView = viewSend.mock.calls.filter(
      ([ch]) => ch === IPC_CHANNELS.SLOT_PRESENCE_CHANGED
    );
    expect(presenceCallsOnView).toHaveLength(0);
  });

  it("with WCV flag off, dispatch still goes to the main window (backward-compatible default)", () => {
    const { window, send } = makeFakeMainWindow();
    registerSlotControllerHandlers(window as unknown as Electron.BrowserWindow);

    // Factory installed but flag never flipped — no view spawned.
    setWebContentsViewFactory({
      create: vi.fn(() => {
        throw new Error("factory must not be called when flag is off");
      }),
    });

    createSlot("slot-1");
    dispatchLoadStream("slot-1", { platform: "kick", channelName: "xqc" });

    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.SLOT_LOAD_STREAM,
      expect.objectContaining({ slotId: "slot-1" })
    );
  });
});
