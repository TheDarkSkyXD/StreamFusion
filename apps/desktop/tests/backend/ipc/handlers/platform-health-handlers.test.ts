import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { ipcMain } from "electron";

import {
  __resetPlatformHealthForTests,
  recordPlatformFailure,
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
  __resetPlatformHealthForTests();
});

describe("registerPlatformHealthHandlers", () => {
  it("registers an invoke handler for PLATFORM_HEALTH_GET", () => {
    const { window } = makeFakeMainWindow();
    registerPlatformHealthHandlers(
      window as unknown as Electron.BrowserWindow
    );

    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.PLATFORM_HEALTH_GET);
  });

  it("returns a snapshot of both platforms' current health from PLATFORM_HEALTH_GET", async () => {
    const { window } = makeFakeMainWindow();
    registerPlatformHealthHandlers(
      window as unknown as Electron.BrowserWindow
    );

    const handler = getInvokeHandler(IPC_CHANNELS.PLATFORM_HEALTH_GET);
    const result = (await handler({})) as { kick: string; twitch: string };

    expect(result).toEqual({ kick: "healthy", twitch: "healthy" });
  });

  it("reflects a tripped kick state in subsequent PLATFORM_HEALTH_GET snapshots", async () => {
    const { window } = makeFakeMainWindow();
    registerPlatformHealthHandlers(
      window as unknown as Electron.BrowserWindow
    );

    // Trip kick to degraded via the state-machine surface.
    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");

    const handler = getInvokeHandler(IPC_CHANNELS.PLATFORM_HEALTH_GET);
    const result = (await handler({})) as { kick: string; twitch: string };

    expect(result).toEqual({ kick: "degraded", twitch: "healthy" });
  });

  it("pushes PLATFORM_HEALTH_CHANGED to the main window webContents on transition", () => {
    const { window, send } = makeFakeMainWindow();
    registerPlatformHealthHandlers(
      window as unknown as Electron.BrowserWindow
    );

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");

    expect(send).toHaveBeenCalledTimes(1);
    const [channel, payload] = send.mock.calls[0];
    expect(channel).toBe(IPC_CHANNELS.PLATFORM_HEALTH_CHANGED);
    expect(payload).toMatchObject({ platform: "kick", status: "degraded" });
    expect(typeof (payload as { startedAt: number }).startedAt).toBe("number");
  });

  it("does not push to a destroyed window", () => {
    const { window, send } = makeFakeMainWindow();
    vi.mocked(window.isDestroyed).mockReturnValue(true);

    registerPlatformHealthHandlers(
      window as unknown as Electron.BrowserWindow
    );

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");

    expect(send).not.toHaveBeenCalled();
  });
});
