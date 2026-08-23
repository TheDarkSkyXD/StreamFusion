import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

// Mock electron BEFORE importing the handler so its imports resolve to our
// fake ipcMain (matching the pattern used by app-handlers.test.ts).
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

vi.mock("@/backend/api/platforms/kick/endpoints/stream-endpoints", () => ({
  clearKickStreamFailureCache: vi.fn(),
}));

import { ipcMain } from "electron";

import { clearKickStreamFailureCache } from "@/backend/api/platforms/kick/endpoints/stream-endpoints";
import {
  __resetPlatformHealthForTests,
  recordPlatformFailure,
  recordPlatformSuccess,
  recordStatusPageSignal,
} from "@/backend/api/unified/platform-health";
import { registerPlatformHealthHandlers } from "@/backend/ipc/handlers/platform-health-handlers";

type InvokeHandler = (event: unknown, args?: unknown) => unknown;

function getInvokeHandler(channel: string): InvokeHandler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, InvokeHandler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`invoke handler not registered: ${channel}`);
  return call[1];
}

function makeFakeMainWindow() {
  const send = vi.fn();
  const webContentsSend = vi.fn();
  const mainFrame = {
    isDestroyed: vi.fn(() => false),
    detached: false,
    send,
  };
  const getMainFrame = vi.fn(() => mainFrame);
  return {
    window: {
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        isCrashed: vi.fn(() => false),
        get mainFrame() {
          return getMainFrame();
        },
        send: webContentsSend,
      },
    },
    getMainFrame,
    mainFrame,
    send,
    webContentsSend,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetPlatformHealthForTests();
});

// Guards: platform-health transitions must target one live main frame without re-resolving a disposed renderer frame
describe("registerPlatformHealthHandlers", () => {
  it("registers an invoke handler for PLATFORM_HEALTH_GET", () => {
    const { window } = makeFakeMainWindow();
    registerPlatformHealthHandlers(window as unknown as Electron.BrowserWindow);

    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.PLATFORM_HEALTH_GET);
  });

  it("returns a snapshot of both platforms' current health from PLATFORM_HEALTH_GET", async () => {
    const { window } = makeFakeMainWindow();
    registerPlatformHealthHandlers(window as unknown as Electron.BrowserWindow);

    const handler = getInvokeHandler(IPC_CHANNELS.PLATFORM_HEALTH_GET);
    const result = (await handler({})) as { kick: string; twitch: string };

    expect(result).toEqual({ kick: "healthy", twitch: "healthy" });
  });

  it("reflects a tripped kick state in subsequent PLATFORM_HEALTH_GET snapshots", async () => {
    const { window } = makeFakeMainWindow();
    registerPlatformHealthHandlers(window as unknown as Electron.BrowserWindow);

    // Trip kick to degraded via the state-machine surface.
    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");

    const handler = getInvokeHandler(IPC_CHANNELS.PLATFORM_HEALTH_GET);
    const result = (await handler({})) as { kick: string; twitch: string };

    expect(result).toEqual({ kick: "degraded", twitch: "healthy" });
  });

  it("includes status-page detail in PLATFORM_HEALTH_GET snapshots when present", async () => {
    const { window } = makeFakeMainWindow();
    registerPlatformHealthHandlers(window as unknown as Electron.BrowserWindow);

    recordStatusPageSignal("kick", "confirmed-outage", {
      summary: "Kick status: Major outage - KICK Outage.",
      impact: "Major outage",
    });

    const handler = getInvokeHandler(IPC_CHANNELS.PLATFORM_HEALTH_GET);
    const result = (await handler({})) as {
      kick: string;
      twitch: string;
      details?: { kick?: { summary: string } };
    };

    expect(result).toMatchObject({
      kick: "degraded",
      twitch: "healthy",
      details: { kick: { summary: "Kick status: Major outage - KICK Outage." } },
    });
  });

  it("pushes PLATFORM_HEALTH_CHANGED through the captured live main frame", () => {
    const { window, getMainFrame, send, webContentsSend } = makeFakeMainWindow();
    registerPlatformHealthHandlers(window as unknown as Electron.BrowserWindow);

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");

    expect(send).toHaveBeenCalledTimes(1);
    const [channel, payload] = send.mock.calls[0];
    expect(channel).toBe(IPC_CHANNELS.PLATFORM_HEALTH_CHANGED);
    expect(payload).toMatchObject({ platform: "kick", status: "degraded" });
    expect(typeof (payload as { startedAt: number }).startedAt).toBe("number");
    expect(getMainFrame).toHaveBeenCalledTimes(1);
    expect(webContentsSend).not.toHaveBeenCalled();
  });

  it("does not push to a destroyed window", () => {
    const { window, send } = makeFakeMainWindow();
    vi.mocked(window.isDestroyed).mockReturnValue(true);

    registerPlatformHealthHandlers(window as unknown as Electron.BrowserWindow);

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");

    expect(send).not.toHaveBeenCalled();
  });

  it("does not push to a crashed renderer webContents", () => {
    const { window, send } = makeFakeMainWindow();
    vi.mocked(window.webContents.isCrashed).mockReturnValue(true);

    registerPlatformHealthHandlers(window as unknown as Electron.BrowserWindow);

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");

    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [
      "destroyed",
      (mainFrame: ReturnType<typeof makeFakeMainWindow>["mainFrame"]) => {
        mainFrame.isDestroyed.mockReturnValue(true);
      },
    ],
    [
      "detached",
      (mainFrame: ReturnType<typeof makeFakeMainWindow>["mainFrame"]) => {
        mainFrame.detached = true;
      },
    ],
  ])("does not push to a %s renderer main frame", (_state, arrangeFrame) => {
    const { window, mainFrame, send, webContentsSend } = makeFakeMainWindow();
    arrangeFrame(mainFrame);

    registerPlatformHealthHandlers(window as unknown as Electron.BrowserWindow);

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");

    expect(send).not.toHaveBeenCalled();
    expect(webContentsSend).not.toHaveBeenCalled();
  });

  it("contains a main-frame send failure", () => {
    const { window, send } = makeFakeMainWindow();
    send.mockImplementation(() => {
      throw new Error("Render frame was disposed before WebFrameMain could be accessed");
    });

    registerPlatformHealthHandlers(window as unknown as Electron.BrowserWindow);

    expect(() => {
      for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    }).not.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

// Guards: Kick cache recovery must run even when renderer transition delivery is unavailable
describe("platform-health-handlers (slice 02: cache flush on recovery)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes Kick failure cache when Kick transitions degraded → healthy", () => {
    const { window } = makeFakeMainWindow();
    registerPlatformHealthHandlers(window as unknown as Electron.BrowserWindow);

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(clearKickStreamFailureCache).not.toHaveBeenCalled();

    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("kick");
    }

    expect(clearKickStreamFailureCache).toHaveBeenCalledTimes(1);
  });

  it("does NOT flush cache on the degraded transition (only on recovery)", () => {
    const { window } = makeFakeMainWindow();
    registerPlatformHealthHandlers(window as unknown as Electron.BrowserWindow);

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");

    expect(clearKickStreamFailureCache).not.toHaveBeenCalled();
  });

  it("does NOT flush Kick cache when Twitch recovers (platform isolation)", () => {
    const { window } = makeFakeMainWindow();
    registerPlatformHealthHandlers(window as unknown as Electron.BrowserWindow);

    for (let i = 0; i < 8; i++) recordPlatformFailure("twitch", "timeout");

    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("twitch");
    }

    expect(clearKickStreamFailureCache).not.toHaveBeenCalled();
  });

  it.each([
    [
      "is detached",
      (mainFrame: ReturnType<typeof makeFakeMainWindow>["mainFrame"]) => {
        mainFrame.detached = true;
      },
    ],
    [
      "throws during send",
      (mainFrame: ReturnType<typeof makeFakeMainWindow>["mainFrame"]) => {
        mainFrame.send.mockImplementation(() => {
          throw new Error("Render frame was disposed before WebFrameMain could be accessed");
        });
      },
    ],
  ])("flushes the Kick failure cache when the renderer main frame %s", (_state, arrangeFrame) => {
    const { window, mainFrame } = makeFakeMainWindow();
    arrangeFrame(mainFrame);
    registerPlatformHealthHandlers(window as unknown as Electron.BrowserWindow);

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");

    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("kick");
    }

    expect(clearKickStreamFailureCache).toHaveBeenCalledTimes(1);
  });
});
