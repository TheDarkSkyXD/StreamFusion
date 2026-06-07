import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/services/update-service", () => ({
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  getUpdateStatus: vi.fn(),
  setAllowPrerelease: vi.fn(),
  setAutoCheck: vi.fn(),
  getUpdateSettings: vi.fn(),
  initUpdateService: vi.fn(),
}));

vi.mock("@/backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ipcMain } from "electron";

import { registerUpdateHandlers } from "@/backend/ipc/handlers/update-handlers";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateSettings,
  getUpdateStatus,
  initUpdateService,
  installUpdate,
  setAllowPrerelease,
  setAutoCheck,
} from "@/backend/services/update-service";

type Handler = (event: unknown, payload?: unknown) => unknown;

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1];
}

const fakeMainWindow = {} as any;

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
    const status = { status: "available", updateInfo: { version: "2.0.0" } };
    vi.mocked(checkForUpdates).mockResolvedValue(status as any);

    const handler = getHandler(IPC_CHANNELS.UPDATE_CHECK);
    const result = await handler({});

    expect(result).toBe(status);
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(checkForUpdates).mockRejectedValue(new Error("net error"));

    const handler = getHandler(IPC_CHANNELS.UPDATE_CHECK);
    const result = (await handler({})) as any;

    expect(result.status).toBe("error");
    expect(result.error).toBe("net error");
  });
});

describe("UPDATE_DOWNLOAD", () => {
  it("delegates to downloadUpdate on success", async () => {
    const status = { status: "downloading" };
    vi.mocked(downloadUpdate).mockResolvedValue(status as any);

    const handler = getHandler(IPC_CHANNELS.UPDATE_DOWNLOAD);
    const result = await handler({});

    expect(result).toBe(status);
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(downloadUpdate).mockRejectedValue(new Error("disk full"));

    const handler = getHandler(IPC_CHANNELS.UPDATE_DOWNLOAD);
    const result = (await handler({})) as any;

    expect(result.status).toBe("error");
    expect(result.error).toBe("disk full");
  });
});

describe("UPDATE_INSTALL", () => {
  it("verifies status is 'downloaded' before installing", () => {
    vi.mocked(getUpdateStatus).mockReturnValue({ status: "downloaded" } as any);

    const handler = getHandler(IPC_CHANNELS.UPDATE_INSTALL);
    const result = handler({}) as any;

    expect(installUpdate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  it("rejects install when status is not 'downloaded'", () => {
    vi.mocked(getUpdateStatus).mockReturnValue({ status: "checking" } as any);

    const handler = getHandler(IPC_CHANNELS.UPDATE_INSTALL);
    const result = handler({}) as any;

    expect(installUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: "No downloaded update to install" });
  });

  it("returns error on install throw", () => {
    vi.mocked(getUpdateStatus).mockReturnValue({ status: "downloaded" } as any);
    vi.mocked(installUpdate).mockImplementation(() => {
      throw new Error("install fail");
    });

    const handler = getHandler(IPC_CHANNELS.UPDATE_INSTALL);
    const result = handler({}) as any;

    expect(result).toEqual({ success: false, error: "install fail" });
  });
});

describe("UPDATE_GET_STATUS", () => {
  it("delegates to getUpdateStatus", () => {
    const status = { status: "idle", updateInfo: null };
    vi.mocked(getUpdateStatus).mockReturnValue(status as any);

    const handler = getHandler(IPC_CHANNELS.UPDATE_GET_STATUS);
    const result = handler({});

    expect(result).toBe(status);
  });
});

describe("UPDATE_SET_ALLOW_PRERELEASE", () => {
  it("rejects non-boolean allow with error", () => {
    const handler = getHandler(IPC_CHANNELS.UPDATE_SET_ALLOW_PRERELEASE);
    const result = handler({}, { allow: "yes" }) as any;

    expect(result.status).toBe("error");
    expect(result.error).toContain("allow must be a boolean");
    expect(setAllowPrerelease).not.toHaveBeenCalled();
  });

  it("rejects undefined payload with error", () => {
    const handler = getHandler(IPC_CHANNELS.UPDATE_SET_ALLOW_PRERELEASE);
    const result = handler({}) as any;

    expect(result.status).toBe("error");
  });

  it("delegates to setAllowPrerelease on valid boolean", () => {
    const status = { allowPrerelease: true };
    vi.mocked(setAllowPrerelease).mockReturnValue(status as any);

    const handler = getHandler(IPC_CHANNELS.UPDATE_SET_ALLOW_PRERELEASE);
    const result = handler({}, { allow: true });

    expect(setAllowPrerelease).toHaveBeenCalledWith(true);
    expect(result).toBe(status);
  });
});

describe("UPDATE_SET_AUTO_CHECK", () => {
  it("passes through valid enabled and frequency", () => {
    const status = { autoCheckEnabled: true, checkFrequency: "hourly" };
    vi.mocked(setAutoCheck).mockReturnValue(status as any);

    const handler = getHandler(IPC_CHANNELS.UPDATE_SET_AUTO_CHECK);
    handler({}, { enabled: true, frequency: "hourly" });

    expect(setAutoCheck).toHaveBeenCalledWith({ enabled: true, frequency: "hourly" });
  });

  it("ignores invalid frequency string", () => {
    vi.mocked(setAutoCheck).mockReturnValue({} as any);

    const handler = getHandler(IPC_CHANNELS.UPDATE_SET_AUTO_CHECK);
    handler({}, { enabled: false, frequency: "every-second" });

    expect(setAutoCheck).toHaveBeenCalledWith({ enabled: false });
  });

  it("ignores non-boolean enabled", () => {
    vi.mocked(setAutoCheck).mockReturnValue({} as any);

    const handler = getHandler(IPC_CHANNELS.UPDATE_SET_AUTO_CHECK);
    handler({}, { enabled: "yes", frequency: "daily" });

    expect(setAutoCheck).toHaveBeenCalledWith({ frequency: "daily" });
  });

  it("handles empty payload gracefully", () => {
    vi.mocked(setAutoCheck).mockReturnValue({} as any);

    const handler = getHandler(IPC_CHANNELS.UPDATE_SET_AUTO_CHECK);
    handler({});

    expect(setAutoCheck).toHaveBeenCalledWith({});
  });
});

describe("UPDATE_GET_SETTINGS", () => {
  it("delegates to getUpdateSettings", () => {
    const settings = { allowPrerelease: false, autoCheckEnabled: true, checkFrequency: "daily" };
    vi.mocked(getUpdateSettings).mockReturnValue(settings as any);

    const handler = getHandler(IPC_CHANNELS.UPDATE_GET_SETTINGS);
    const result = handler({});

    expect(result).toBe(settings);
  });

  it("returns fallback on error", () => {
    vi.mocked(getUpdateSettings).mockImplementation(() => {
      throw new Error("corrupt");
    });

    const handler = getHandler(IPC_CHANNELS.UPDATE_GET_SETTINGS);
    const result = handler({}) as any;

    expect(result).toEqual({
      allowPrerelease: false,
      autoCheckEnabled: false,
      checkFrequency: "daily",
    });
  });
});
