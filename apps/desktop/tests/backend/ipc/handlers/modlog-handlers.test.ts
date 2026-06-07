import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/services/database-service", () => ({
  dbService: {
    insertModLog: vi.fn(),
    queryModLog: vi.fn(),
    sweepModLogRetention: vi.fn(),
    getRetentionSetting: vi.fn(),
    setRetentionSetting: vi.fn(),
  },
}));

import { ipcMain } from "electron";

import { registerModLogHandlers } from "@/backend/ipc/handlers/modlog-handlers";
import { dbService } from "@/backend/services/database-service";

type Handler = (event: unknown, args?: unknown) => unknown;

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  registerModLogHandlers();
});

describe("registerModLogHandlers", () => {
  it("registers all five IPC channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.MODLOG_INSERT);
    expect(channels).toContain(IPC_CHANNELS.MODLOG_QUERY);
    expect(channels).toContain(IPC_CHANNELS.MODLOG_SWEEP_RETENTION);
    expect(channels).toContain(IPC_CHANNELS.RETENTION_GET);
    expect(channels).toContain(IPC_CHANNELS.RETENTION_SET);
  });
});

describe("MODLOG_INSERT", () => {
  it("passes the entry to dbService.insertModLog and returns its result", () => {
    const entry = {
      platform: "kick",
      channelId: "123",
      channelName: "test",
      action: "ban",
      targetUser: "badguy",
      moderator: "modguy",
      timestamp: Date.now(),
    };
    const row = { id: 1, ...entry };
    vi.mocked(dbService.insertModLog).mockReturnValue(row as any);

    const handler = getHandler(IPC_CHANNELS.MODLOG_INSERT);
    const result = handler({}, { entry });

    expect(dbService.insertModLog).toHaveBeenCalledWith(entry);
    expect(result).toBe(row);
  });
});

describe("MODLOG_QUERY", () => {
  it("passes filters to dbService.queryModLog and returns its result", () => {
    const filters = { channelId: "123", limit: 50, offset: 0 };
    const rows = [{ id: 1 }, { id: 2 }];
    vi.mocked(dbService.queryModLog).mockReturnValue(rows as any);

    const handler = getHandler(IPC_CHANNELS.MODLOG_QUERY);
    const result = handler({}, { filters });

    expect(dbService.queryModLog).toHaveBeenCalledWith(filters);
    expect(result).toBe(rows);
  });
});

describe("MODLOG_SWEEP_RETENTION", () => {
  it("passes now to dbService.sweepModLogRetention", () => {
    const now = Date.now();
    vi.mocked(dbService.sweepModLogRetention).mockReturnValue(5 as any);

    const handler = getHandler(IPC_CHANNELS.MODLOG_SWEEP_RETENTION);
    const result = handler({}, { now });

    expect(dbService.sweepModLogRetention).toHaveBeenCalledWith(now);
    expect(result).toBe(5);
  });

  it("calls sweepModLogRetention with undefined when no now is provided", () => {
    vi.mocked(dbService.sweepModLogRetention).mockReturnValue(0 as any);

    const handler = getHandler(IPC_CHANNELS.MODLOG_SWEEP_RETENTION);
    handler({});

    expect(dbService.sweepModLogRetention).toHaveBeenCalledWith(undefined);
  });
});

describe("RETENTION_GET", () => {
  it("returns the retention setting for the given scope", () => {
    vi.mocked(dbService.getRetentionSetting).mockReturnValue(30 as any);

    const handler = getHandler(IPC_CHANNELS.RETENTION_GET);
    const result = handler({}, { scope: "modlog" });

    expect(dbService.getRetentionSetting).toHaveBeenCalledWith("modlog");
    expect(result).toBe(30);
  });
});

describe("RETENTION_SET", () => {
  it("sets the retention setting for the given scope and days", () => {
    const handler = getHandler(IPC_CHANNELS.RETENTION_SET);
    handler({}, { scope: "modlog", days: 90 });

    expect(dbService.setRetentionSetting).toHaveBeenCalledWith("modlog", 90);
  });

  it("accepts null days to disable retention", () => {
    const handler = getHandler(IPC_CHANNELS.RETENTION_SET);
    handler({}, { scope: "modlog", days: null });

    expect(dbService.setRetentionSetting).toHaveBeenCalledWith("modlog", null);
  });
});
