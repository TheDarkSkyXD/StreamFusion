import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/services/database-service", () => ({
  dbService: {
    insertModLog: vi.fn(),
    queryModLog: vi.fn(),
    getModLogCoverage: vi.fn(),
    setModLogCoverage: vi.fn(),
    sweepModLogRetention: vi.fn(),
    getRetentionSetting: vi.fn(),
    setRetentionSetting: vi.fn(),
  },
}));

vi.mock("@/backend/services/moderation-history-authorization", () => ({
  authorizeModerationHistory: vi.fn(),
}));

import { ipcMain } from "electron";

import { registerModLogHandlers } from "@/backend/ipc/handlers/modlog-handlers";
import { dbService } from "@/backend/services/database-service";
import { authorizeModerationHistory } from "@/backend/services/moderation-history-authorization";
import type { ModLogEntry } from "@/shared/mod-log-types";

type Handler = (event: unknown, args?: unknown) => unknown;
const allowedEvent = { senderFrame: { url: "http://localhost:5173/browser.html" } };

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return (event, args) => Reflect.apply(call[1], undefined, [event, args]);
}

function modLogEntry(id: number, action = "ban"): ModLogEntry {
  return { id, platform: "twitch", channelId: "123", channelSlug: "channel", action, targetUserId: "target", targetUsername: "target", moderatorUserId: "mod", moderatorUsername: "mod", provenance: "twitch-eventsub", providerEventId: null, occurredAt: 100, observedAt: 100, createdAt: 100 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authorizeModerationHistory).mockResolvedValue({
    state: "authorized",
    role: "moderator",
  });
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
  it("persists an authorized provider-originated entry and marks partial coverage", async () => {
    const entry = {
      platform: "kick" as const,
      channelId: "123",
      channelSlug: "test",
      action: "ban",
      targetUserId: "badguy",
      targetUsername: "badguy",
      moderatorUserId: "modguy",
      moderatorUsername: "modguy",
      durationSeconds: null,
      reason: null,
      provenance: "streamfusion-confirmed" as const,
      providerEventId: null,
      occurredAt: 100,
      observedAt: 101,
    };
    vi.mocked(dbService.insertModLog).mockReturnValue(1);

    const handler = getHandler(IPC_CHANNELS.MODLOG_INSERT);
    const result = await handler(allowedEvent, { entry });

    expect(dbService.insertModLog).toHaveBeenCalledWith(entry);
    expect(dbService.setModLogCoverage).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "kick",
        channelId: "123",
        coverage: "partial",
      })
    );
    expect(result).toEqual({ success: true, id: 1 });
  });

  it("does not persist an action when current-channel moderator authority is unverified", async () => {
    vi.mocked(authorizeModerationHistory).mockResolvedValue({
      state: "denied",
      reason: "unverified",
    });
    const handler = getHandler(IPC_CHANNELS.MODLOG_INSERT);
    const result = await handler(allowedEvent, {
      entry: {
        platform: "kick",
        channelId: "123",
        channelSlug: "channel",
        action: "ban",
        targetUserId: "bad",
        targetUsername: "bad",
        moderatorUserId: "mod",
        moderatorUsername: "mod",
        durationSeconds: null,
        reason: null,
        provenance: "streamfusion-confirmed",
        providerEventId: null,
        occurredAt: 100,
        observedAt: 101,
      },
    });

    expect(result).toEqual({
      success: false,
      code: "unverified",
      retryable: true,
    });
    expect(dbService.insertModLog).not.toHaveBeenCalled();
  });
});

describe("MODLOG_QUERY", () => {
  it("fails closed before reading history for a renderer outside the app origin", async () => {
    const handler = getHandler(IPC_CHANNELS.MODLOG_QUERY);
    const result = await handler(
      { senderFrame: { url: "https://example.com/embedded" } },
      { filters: { platform: "twitch", channelId: "123", channelSlug: "channel" } }
    );

    expect(result).toEqual({
      state: "error",
      entries: [],
      code: "forbidden",
      retryable: false,
    });
    expect(dbService.queryModLog).not.toHaveBeenCalled();
  });

  it("fails closed when the platform confirms the viewer is not a moderator", async () => {
    vi.mocked(authorizeModerationHistory).mockResolvedValue({
      state: "denied",
      reason: "viewer",
    });
    const handler = getHandler(IPC_CHANNELS.MODLOG_QUERY);
    const result = await handler(allowedEvent, {
      filters: {
        platform: "kick",
        channelId: "123",
        channelSlug: "channel",
        targetUserId: "target",
      },
    });

    expect(result).toEqual({
      state: "error",
      entries: [],
      code: "unauthorized",
      retryable: false,
    });
    expect(dbService.queryModLog).not.toHaveBeenCalled();
  });

  it("returns ready records only when persisted coverage is complete", async () => {
    const filters = {
      platform: "twitch" as const,
      channelId: "123",
      channelSlug: "channel",
      limit: 50,
      offset: 0,
    };
    const rows = [modLogEntry(1), modLogEntry(2)];
    vi.mocked(dbService.queryModLog).mockReturnValue(rows);
    vi.mocked(dbService.getModLogCoverage).mockReturnValue({
      platform: "twitch",
      channelId: "123",
      coverage: "complete",
      source: "provider-query",
      coverageStartAt: null,
      coverageEndAt: 200,
      observedAt: 200,
    });

    const handler = getHandler(IPC_CHANNELS.MODLOG_QUERY);
    const result = await handler(allowedEvent, { filters });

    expect(dbService.queryModLog).toHaveBeenCalledWith(filters);
    expect(result).toEqual({ state: "ready", entries: rows, coverage: "complete" });
  });

  it("returns available records as partial when the persisted observation window is incomplete", async () => {
    const rows = [modLogEntry(1)];
    vi.mocked(dbService.queryModLog).mockReturnValue(rows);
    vi.mocked(dbService.getModLogCoverage).mockReturnValue({
      platform: "twitch",
      channelId: "123",
      coverage: "partial",
      source: "eventsub-observation",
      coverageStartAt: 100,
      coverageEndAt: 200,
      observedAt: 200,
    });

    const handler = getHandler(IPC_CHANNELS.MODLOG_QUERY);
    const result = await handler(allowedEvent, {
      filters: {
        platform: "twitch",
        channelId: "123",
        channelSlug: "channel",
        targetUserId: "target",
      },
    });

    expect(result).toEqual({
      state: "partial",
      entries: rows,
      coverage: "partial",
      reason: "observation-window",
    });
  });

  it("returns verified-empty only for an authorized complete provider query", async () => {
    vi.mocked(dbService.queryModLog).mockReturnValue([]);
    vi.mocked(dbService.getModLogCoverage).mockReturnValue({
      platform: "kick",
      channelId: "123",
      coverage: "complete",
      source: "provider-query",
      coverageStartAt: null,
      coverageEndAt: 200,
      observedAt: 200,
    });

    const handler = getHandler(IPC_CHANNELS.MODLOG_QUERY);
    const result = await handler(allowedEvent, {
      filters: {
        platform: "kick",
        channelId: "123",
        channelSlug: "channel",
        targetUserId: "target",
      },
    });

    expect(result).toEqual({
      state: "verified-empty",
      entries: [],
      coverage: "complete",
    });
  });

  it("returns a retryable error instead of verified-empty when storage fails", async () => {
    vi.mocked(dbService.queryModLog).mockImplementation(() => {
      throw new Error("database locked");
    });

    const handler = getHandler(IPC_CHANNELS.MODLOG_QUERY);
    const result = await handler(allowedEvent, {
      filters: {
        platform: "twitch",
        channelId: "123",
        channelSlug: "channel",
        targetUserId: "target",
      },
    });

    expect(result).toEqual({
      state: "error",
      entries: [],
      code: "query-failed",
      retryable: true,
    });
  });
});

describe("MODLOG_SWEEP_RETENTION", () => {
  it("passes now to dbService.sweepModLogRetention", () => {
    const now = Date.now();
    vi.mocked(dbService.sweepModLogRetention).mockReturnValue(5);

    const handler = getHandler(IPC_CHANNELS.MODLOG_SWEEP_RETENTION);
    const result = handler({}, { now });

    expect(dbService.sweepModLogRetention).toHaveBeenCalledWith(now);
    expect(result).toBe(5);
  });

  it("calls sweepModLogRetention with undefined when no now is provided", () => {
    vi.mocked(dbService.sweepModLogRetention).mockReturnValue(0);

    const handler = getHandler(IPC_CHANNELS.MODLOG_SWEEP_RETENTION);
    handler({});

    expect(dbService.sweepModLogRetention).toHaveBeenCalledWith(undefined);
  });
});

describe("RETENTION_GET", () => {
  it("returns the retention setting for the given scope", () => {
    vi.mocked(dbService.getRetentionSetting).mockReturnValue(30);

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
