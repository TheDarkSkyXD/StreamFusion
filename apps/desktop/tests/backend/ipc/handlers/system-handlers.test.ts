import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveNotificationCoverageStatus } from "@shared/auth-types";
import { IPC_CHANNELS } from "@shared/ipc-channels";

const liveNotificationServiceMock = vi.hoisted(() => ({
  getCoverageStatus: vi.fn<() => LiveNotificationCoverageStatus>(() => ({
    desktop: { supported: true, permission: "unknown" },
    platforms: {
      twitch: { status: "normal", issues: [] },
      kick: { status: "normal", issues: [] },
    },
  })),
}));

const storageServiceMock = vi.hoisted(() => ({
  getPreferences: vi.fn(() => ({
    notifications: {
      enabled: true,
      sound: true,
    },
  })),
}));

const notificationMock = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
  show: vi.fn(),
  isSupported: vi.fn(),
}));

vi.mock("electron", () => {
  class MockNotification {
    static isSupported = notificationMock.isSupported;
    static _options = notificationMock.options;
    show = notificationMock.show;
    constructor(opts: Record<string, unknown>) {
      notificationMock.options.push(opts);
    }
  }

  return {
    BrowserWindow: class {},
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
    },
    app: {
      getVersion: vi.fn(() => "1.0.0"),
      getName: vi.fn(() => "StreamFusion"),
    },
    nativeTheme: {
      shouldUseDarkColors: true,
    },
    shell: {
      openExternal: vi.fn(),
    },
    Notification: MockNotification,
  };
});

vi.mock("@backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock("@backend/services/live-notification-service", () => ({
  liveNotificationService: liveNotificationServiceMock,
}));

vi.mock("@backend/services/storage-service", () => ({
  storageService: storageServiceMock,
}));

import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";

import { registerSystemHandlers as registerWithRenderer } from "@backend/ipc/handlers/system-handlers";
import { createMainRendererPortMock } from "../../../helpers/main-renderer-port-mock";

type InvokeHandler = (event: unknown, args?: unknown) => unknown;
type OnHandler = (event: unknown, ...args: unknown[]) => void;

function getInvokeHandler(channel: string): InvokeHandler {
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`invoke handler not registered: ${channel}`);
  return (event, args) => Reflect.apply(call[1], undefined, [event, args]);
}

function getOnHandler(channel: string): OnHandler {
  const calls = vi.mocked(ipcMain.on).mock.calls;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`on handler not registered: ${channel}`);
  return (event, ...args) => Reflect.apply(call[1], undefined, [event, ...args]);
}

function makeFakeMainWindow() {
  return Object.assign(new BrowserWindow(), {
    isDestroyed: vi.fn(() => false),
    isMaximized: vi.fn(() => false),
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
      toggleDevTools: vi.fn(),
    },
  });
}

function registerSystemHandlers(window: Electron.BrowserWindow): void {
  registerWithRenderer(createMainRendererPortMock(window));
}

let mainWindow: ReturnType<typeof makeFakeMainWindow>;

beforeEach(() => {
  vi.clearAllMocks();
  notificationMock.options.length = 0;
  mainWindow = makeFakeMainWindow();
  registerSystemHandlers(mainWindow);
});

describe("App Info handlers", () => {
  it("APP_GET_VERSION returns app version", () => {
    const handler = getInvokeHandler(IPC_CHANNELS.APP_GET_VERSION);
    expect(handler({})).toBe("1.0.0");
  });

  it("APP_GET_NAME returns app name", () => {
    const handler = getInvokeHandler(IPC_CHANNELS.APP_GET_NAME);
    expect(handler({})).toBe("StreamFusion");
  });

  it("APP_GET_VERSION_INFO detects stable version", () => {
    vi.mocked(app.getVersion).mockReturnValue("1.2.3");
    vi.clearAllMocks();
    mainWindow = makeFakeMainWindow();
    registerSystemHandlers(mainWindow);

    const handler = getInvokeHandler(IPC_CHANNELS.APP_GET_VERSION_INFO);
    const info = handler({}) as { version: string; isPrerelease: boolean; channel: string; displayVersion: string };

    expect(info.version).toBe("1.2.3");
    expect(info.isPrerelease).toBe(false);
    expect(info.channel).toBe("stable");
    expect(info.displayVersion).toBe("1.2.3");
  });

  it("APP_GET_VERSION_INFO detects beta prerelease", () => {
    vi.mocked(app.getVersion).mockReturnValue("2.0.0-beta.1");
    vi.clearAllMocks();
    mainWindow = makeFakeMainWindow();
    registerSystemHandlers(mainWindow);

    const handler = getInvokeHandler(IPC_CHANNELS.APP_GET_VERSION_INFO);
    const info = handler({}) as { isPrerelease: boolean; channel: string; displayVersion: string };

    expect(info.isPrerelease).toBe(true);
    expect(info.channel).toBe("beta");
    expect(info.displayVersion).toBe("2.0.0-beta.1 (Beta)");
  });

  it("APP_GET_VERSION_INFO detects alpha prerelease", () => {
    vi.mocked(app.getVersion).mockReturnValue("3.0.0-alpha.2");
    vi.clearAllMocks();
    mainWindow = makeFakeMainWindow();
    registerSystemHandlers(mainWindow);

    const handler = getInvokeHandler(IPC_CHANNELS.APP_GET_VERSION_INFO);
    const info = handler({}) as { channel: string; displayVersion: string };

    expect(info.channel).toBe("alpha");
    expect(info.displayVersion).toBe("3.0.0-alpha.2 (Alpha)");
  });

  it("APP_GET_VERSION_INFO detects rc prerelease", () => {
    vi.mocked(app.getVersion).mockReturnValue("1.0.0-rc.1");
    vi.clearAllMocks();
    mainWindow = makeFakeMainWindow();
    registerSystemHandlers(mainWindow);

    const handler = getInvokeHandler(IPC_CHANNELS.APP_GET_VERSION_INFO);
    const info = handler({}) as { channel: string; displayVersion: string };

    expect(info.channel).toBe("rc");
    expect(info.displayVersion).toBe("1.0.0-rc.1 (Rc)");
  });
});

describe("Window Management handlers", () => {
  it("WINDOW_MINIMIZE calls mainWindow.minimize", () => {
    const handler = getOnHandler(IPC_CHANNELS.WINDOW_MINIMIZE);
    handler({});
    expect(mainWindow.minimize).toHaveBeenCalledTimes(1);
  });

  it("WINDOW_MINIMIZE does nothing if window is destroyed", () => {
    mainWindow.isDestroyed.mockReturnValue(true);
    const handler = getOnHandler(IPC_CHANNELS.WINDOW_MINIMIZE);
    handler({});
    expect(mainWindow.minimize).not.toHaveBeenCalled();
  });

  it("WINDOW_MAXIMIZE maximizes when not maximized", () => {
    mainWindow.isMaximized.mockReturnValue(false);
    const handler = getOnHandler(IPC_CHANNELS.WINDOW_MAXIMIZE);
    handler({});
    expect(mainWindow.maximize).toHaveBeenCalledTimes(1);
    expect(mainWindow.unmaximize).not.toHaveBeenCalled();
  });

  it("WINDOW_MAXIMIZE unmaximizes when already maximized", () => {
    mainWindow.isMaximized.mockReturnValue(true);
    const handler = getOnHandler(IPC_CHANNELS.WINDOW_MAXIMIZE);
    handler({});
    expect(mainWindow.unmaximize).toHaveBeenCalledTimes(1);
    expect(mainWindow.maximize).not.toHaveBeenCalled();
  });

  it("WINDOW_CLOSE calls mainWindow.close", () => {
    const handler = getOnHandler(IPC_CHANNELS.WINDOW_CLOSE);
    handler({});
    expect(mainWindow.close).toHaveBeenCalledTimes(1);
  });

  it("WINDOW_IS_MAXIMIZED returns maximized state", () => {
    mainWindow.isMaximized.mockReturnValue(true);
    const handler = getInvokeHandler(IPC_CHANNELS.WINDOW_IS_MAXIMIZED);
    expect(handler({})).toBe(true);
  });
});

describe("WINDOW_TOGGLE_DEV_TOOLS", () => {
  it("toggles dev tools in non-production", () => {
    const handler = getOnHandler(IPC_CHANNELS.WINDOW_TOGGLE_DEV_TOOLS);
    handler({});
    expect(mainWindow.webContents.toggleDevTools).toHaveBeenCalledTimes(1);
  });
});

describe("Theme handler", () => {
  it("THEME_GET_SYSTEM returns 'dark' when shouldUseDarkColors is true", () => {
    Reflect.set(nativeTheme, "shouldUseDarkColors", true);
    const handler = getInvokeHandler(IPC_CHANNELS.THEME_GET_SYSTEM);
    expect(handler({})).toBe("dark");
  });

  it("THEME_GET_SYSTEM returns 'light' when shouldUseDarkColors is false", () => {
    Reflect.set(nativeTheme, "shouldUseDarkColors", false);
    const handler = getInvokeHandler(IPC_CHANNELS.THEME_GET_SYSTEM);
    expect(handler({})).toBe("light");
  });
});

describe("SHELL_OPEN_EXTERNAL", () => {
  it("opens valid https URL", async () => {
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);

    const handler = getInvokeHandler(IPC_CHANNELS.SHELL_OPEN_EXTERNAL);
    await handler({}, { url: "https://example.com" });

    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("opens valid http URL", async () => {
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);

    const handler = getInvokeHandler(IPC_CHANNELS.SHELL_OPEN_EXTERNAL);
    await handler({}, { url: "http://example.com" });

    expect(shell.openExternal).toHaveBeenCalledWith("http://example.com");
  });

  it("rejects non-http protocols (file:// etc.)", async () => {
    const handler = getInvokeHandler(IPC_CHANNELS.SHELL_OPEN_EXTERNAL);
    await handler({}, { url: "file:///etc/passwd" });

    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("rejects invalid URL gracefully", async () => {
    const handler = getInvokeHandler(IPC_CHANNELS.SHELL_OPEN_EXTERNAL);
    await handler({}, { url: "not-a-url" });

    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});

describe("NOTIFICATION_SHOW", () => {
  it("shows notification when supported", () => {
    const isSupportedFn = notificationMock.isSupported;
    const showFn = notificationMock.show;
    isSupportedFn.mockReturnValue(true);

    const handler = getInvokeHandler(IPC_CHANNELS.NOTIFICATION_SHOW);
    handler({}, { title: "Test", body: "Body" });

    expect(showFn).toHaveBeenCalledTimes(1);
  });

  it("does not show notification when not supported", () => {
    const isSupportedFn = notificationMock.isSupported;
    const showFn = notificationMock.show;
    isSupportedFn.mockReturnValue(false);

    const handler = getInvokeHandler(IPC_CHANNELS.NOTIFICATION_SHOW);
    handler({}, { title: "Test", body: "Body" });

    expect(showFn).not.toHaveBeenCalled();
  });

  it("does not show notification when desktop notifications are disabled", () => {
    const isSupportedFn = notificationMock.isSupported;
    const showFn = notificationMock.show;
    isSupportedFn.mockReturnValue(true);
    storageServiceMock.getPreferences.mockReturnValueOnce({
      notifications: { enabled: false, sound: true },
    });

    const handler = getInvokeHandler(IPC_CHANNELS.NOTIFICATION_SHOW);
    handler({}, { title: "Test", body: "Body" });

    expect(showFn).not.toHaveBeenCalled();
  });

  it("uses a silent native notification when sound is disabled", () => {
    const isSupportedFn = notificationMock.isSupported;
    const showFn = notificationMock.show;
    isSupportedFn.mockReturnValue(true);
    storageServiceMock.getPreferences.mockReturnValueOnce({
      notifications: { enabled: true, sound: false },
    });

    const handler = getInvokeHandler(IPC_CHANNELS.NOTIFICATION_SHOW);
    handler({}, { title: "Test", body: "Body" });

    expect(showFn).toHaveBeenCalledTimes(1);
    expect(notificationMock.options[0]).toMatchObject({ silent: true });
  });
});

describe("NOTIFICATION_COVERAGE_GET", () => {
  it("returns the live notification coverage snapshot", async () => {
    liveNotificationServiceMock.getCoverageStatus.mockReturnValueOnce({
      desktop: { supported: false, permission: "unsupported" },
      platforms: {
        twitch: {
          status: "degraded",
          issues: [
            {
              platform: "twitch",
              reason: "eventsub-failed",
              message: "Twitch EventSub unavailable",
              firstSeenAt: 1,
              lastSeenAt: 1,
            },
          ],
        },
        kick: { status: "normal", issues: [] },
      },
    });

    const handler = getInvokeHandler(IPC_CHANNELS.NOTIFICATION_COVERAGE_GET);
    const status = await handler({});

    expect(status).toMatchObject({
      desktop: { supported: false, permission: "unsupported" },
      platforms: {
        twitch: { status: "degraded" },
        kick: { status: "normal" },
      },
    });
  });
});
