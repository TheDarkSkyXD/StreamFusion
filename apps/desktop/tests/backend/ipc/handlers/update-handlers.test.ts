import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS, type UpdateState } from "@shared/ipc-channels";

vi.mock("electron", () => ({
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@backend/services/update-service", () => ({
  DEFAULT_UPDATE_CHECK_URL: "https://updates.example.com",
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  getUpdateStatus: vi.fn(),
  setAllowPrerelease: vi.fn(),
  setAutoCheck: vi.fn(),
  getUpdateSettings: vi.fn(),
  initUpdateService: vi.fn(),
}));

vi.mock("@backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { BrowserWindow, ipcMain } from "electron";

import { registerUpdateHandlers } from "@backend/ipc/handlers/update-handlers";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateSettings,
  getUpdateStatus,
  initUpdateService,
  installUpdate,
  setAllowPrerelease,
  setAutoCheck,
} from "@backend/services/update-service";

type Handler = (event: unknown, payload?: unknown) => unknown;

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return (event, payload) => Reflect.apply(call[1], undefined, [event, payload]);
}

const fakeMainWindow = new BrowserWindow();

function updateState(overrides: Partial<UpdateState> = {}): UpdateState {
  return {
    status: "idle",
    updateInfo: null,
    progress: null,
    error: null,
    allowPrerelease: false,
    autoCheckEnabled: false,
    checkFrequency: "daily",
    updateCheckUrl: "https://updates.example.com",
    ...overrides,
  };
}

function resultRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("Expected handler result object");
  return value as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  registerUpdateHandlers(fakeMainWindow);
});

describe("registerUpdateHandlers", () => {
  it("registers all seven update IPC channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.UPDATE_CHECK);
    expect(channels).toContain(IPC_CHANNELS.UPDATE_DOWNLOAD);
    expect(channels).toContain(IPC_CHANNELS.UPDATE_INSTALL);
    expect(channels).toContain(IPC_CHANNELS.UPDATE_GET_STATUS);
    expect(channels).toContain(IPC_CHANNELS.UPDATE_SET_ALLOW_PRERELEASE);
    expect(channels).toContain(IPC_CHANNELS.UPDATE_SET_AUTO_CHECK);
    expect(channels).toContain(IPC_CHANNELS.UPDATE_GET_SETTINGS);
  });

  it("initializes the update service after registering handlers", () => {
    expect(initUpdateService).toHaveBeenCalledWith(fakeMainWindow);
  });

  it("does not crash if initUpdateService throws", () => {
    vi.clearAllMocks();
    vi.mocked(initUpdateService).mockImplementation(() => {
      throw new Error("dev mode");
    });
    expect(() => registerUpdateHandlers(fakeMainWindow)).not.toThrow();
  });
});

describe("UPDATE_CHECK", () => {
  it("delegates to checkForUpdates on success", async () => {
    const status = updateState({
      status: "available",
      updateInfo: { version: "2.0.0", releaseDate: "", releaseNotes: null, releaseName: null },
    });
    vi.mocked(checkForUpdates).mockResolvedValue(status);

    const handler = getHandler(IPC_CHANNELS.UPDATE_CHECK);
    const result = await handler({});

    expect(result).toBe(status);
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(checkForUpdates).mockRejectedValue(new Error("net error"));

    const handler = getHandler(IPC_CHANNELS.UPDATE_CHECK);
    const result = resultRecord(await handler({}));

    expect(result.status).toBe("error");
    expect(result.error).toBe("net error");
  });
});

describe("UPDATE_DOWNLOAD", () => {
  it("delegates to downloadUpdate on success", async () => {
    const status = updateState({ status: "downloading" });
    vi.mocked(downloadUpdate).mockResolvedValue(status);

    const handler = getHandler(IPC_CHANNELS.UPDATE_DOWNLOAD);
    const result = await handler({});

    expect(result).toBe(status);
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(downloadUpdate).mockRejectedValue(new Error("disk full"));

    const handler = getHandler(IPC_CHANNELS.UPDATE_DOWNLOAD);
    const result = resultRecord(await handler({}));

    expect(result.status).toBe("error");
    expect(result.error).toBe("disk full");
  });
});

describe("UPDATE_INSTALL", () => {
  it("verifies status is 'downloaded' before installing", () => {
    vi.mocked(getUpdateStatus).mockReturnValue(updateState({ status: "downloaded" }));

    const handler = getHandler(IPC_CHANNELS.UPDATE_INSTALL);
    const result = resultRecord(handler({}));

    expect(installUpdate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  it("rejects install when status is not 'downloaded'", () => {
    vi.mocked(getUpdateStatus).mockReturnValue(updateState({ status: "checking" }));

    const handler = getHandler(IPC_CHANNELS.UPDATE_INSTALL);
    const result = resultRecord(handler({}));

    expect(installUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: "No downloaded update to install" });
  });

  it("returns error on install throw", () => {
    vi.mocked(getUpdateStatus).mockReturnValue(updateState({ status: "downloaded" }));
    vi.mocked(installUpdate).mockImplementation(() => {
      throw new Error("install fail");
    });

    const handler = getHandler(IPC_CHANNELS.UPDATE_INSTALL);
    const result = resultRecord(handler({}));

    expect(result).toEqual({ success: false, error: "install fail" });
  });
});

describe("UPDATE_GET_STATUS", () => {
  it("delegates to getUpdateStatus", () => {
    const status = updateState();
    vi.mocked(getUpdateStatus).mockReturnValue(status);

    const handler = getHandler(IPC_CHANNELS.UPDATE_GET_STATUS);
    const result = handler({});

    expect(result).toBe(status);
  });
});

describe("UPDATE_SET_ALLOW_PRERELEASE", () => {
  it("rejects non-boolean allow with error", () => {
    const handler = getHandler(IPC_CHANNELS.UPDATE_SET_ALLOW_PRERELEASE);
    const result = resultRecord(handler({}, { allow: "yes" }));

    expect(result.status).toBe("error");
    expect(result.error).toContain("allow must be a boolean");
    expect(setAllowPrerelease).not.toHaveBeenCalled();
  });

  it("rejects undefined payload with error", () => {
    const handler = getHandler(IPC_CHANNELS.UPDATE_SET_ALLOW_PRERELEASE);
    const result = resultRecord(handler({}));

    expect(result.status).toBe("error");
  });

  it("delegates to setAllowPrerelease on valid boolean", () => {
    const status = updateState({ allowPrerelease: true });
    vi.mocked(setAllowPrerelease).mockReturnValue(status);

    const handler = getHandler(IPC_CHANNELS.UPDATE_SET_ALLOW_PRERELEASE);
    const result = handler({}, { allow: true });

    expect(setAllowPrerelease).toHaveBeenCalledWith(true);
    expect(result).toBe(status);
  });
});

describe("UPDATE_SET_AUTO_CHECK", () => {
  it("passes through valid enabled and frequency", () => {
    const status = updateState({ autoCheckEnabled: true, checkFrequency: "hourly" });
    vi.mocked(setAutoCheck).mockReturnValue(status);

    const handler = getHandler(IPC_CHANNELS.UPDATE_SET_AUTO_CHECK);
    handler({}, { enabled: true, frequency: "hourly" });

    expect(setAutoCheck).toHaveBeenCalledWith({ enabled: true, frequency: "hourly" });
  });

  it("ignores invalid frequency string", () => {
    vi.mocked(setAutoCheck).mockReturnValue(updateState());

    const handler = getHandler(IPC_CHANNELS.UPDATE_SET_AUTO_CHECK);
    handler({}, { enabled: false, frequency: "every-second" });

    expect(setAutoCheck).toHaveBeenCalledWith({ enabled: false });
  });

  it("ignores non-boolean enabled", () => {
    vi.mocked(setAutoCheck).mockReturnValue(updateState());

    const handler = getHandler(IPC_CHANNELS.UPDATE_SET_AUTO_CHECK);
    handler({}, { enabled: "yes", frequency: "daily" });

    expect(setAutoCheck).toHaveBeenCalledWith({ frequency: "daily" });
  });

  it("handles empty payload gracefully", () => {
    vi.mocked(setAutoCheck).mockReturnValue(updateState());

    const handler = getHandler(IPC_CHANNELS.UPDATE_SET_AUTO_CHECK);
    handler({});

    expect(setAutoCheck).toHaveBeenCalledWith({});
  });

  it("accepts only HTTPS update feed URLs", () => {
    vi.mocked(setAutoCheck).mockReturnValue(updateState());
    const handler = getHandler(IPC_CHANNELS.UPDATE_SET_AUTO_CHECK);

    handler({}, { updateCheckUrl: "https://updates.example.com/feed/" });
    expect(setAutoCheck).toHaveBeenLastCalledWith({
      updateCheckUrl: "https://updates.example.com/feed",
    });

    handler({}, { updateCheckUrl: "javascript:alert(1)" });
    expect(setAutoCheck).toHaveBeenLastCalledWith({});
  });
});

describe("UPDATE_GET_SETTINGS", () => {
  it("delegates to getUpdateSettings", () => {
    const settings = {
      allowPrerelease: false,
      autoCheckEnabled: true,
      checkFrequency: "daily" as const,
      updateCheckUrl: "https://updates.example.com",
    };
    vi.mocked(getUpdateSettings).mockReturnValue(settings);

    const handler = getHandler(IPC_CHANNELS.UPDATE_GET_SETTINGS);
    const result = handler({});

    expect(result).toBe(settings);
  });

  it("returns fallback on error", () => {
    vi.mocked(getUpdateSettings).mockImplementation(() => {
      throw new Error("corrupt");
    });

    const handler = getHandler(IPC_CHANNELS.UPDATE_GET_SETTINGS);
    const result = resultRecord(handler({}));

    expect(result).toEqual({
      allowPrerelease: false,
      autoCheckEnabled: false,
      checkFrequency: "weekly",
      updateCheckUrl: "https://updates.example.com",
    });
  });
});
