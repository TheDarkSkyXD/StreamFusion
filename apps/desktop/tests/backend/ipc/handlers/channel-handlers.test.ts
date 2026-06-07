import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/api/platforms/twitch/twitch-client", () => ({
  twitchClient: {
    getChannelsById: vi.fn(),
    getChannelByLogin: vi.fn(),
    isAuthenticated: vi.fn(),
    getAllFollowedChannels: vi.fn(),
  },
}));

vi.mock("@/backend/api/platforms/kick/kick-client", () => ({
  kickClient: {
    getChannel: vi.fn(),
  },
}));

vi.mock("@/backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ipcMain } from "electron";

import { kickClient } from "@/backend/api/platforms/kick/kick-client";
import { twitchClient } from "@/backend/api/platforms/twitch/twitch-client";
import { registerChannelHandlers } from "@/backend/ipc/handlers/channel-handlers";

type Handler = (event: unknown, params: unknown) => Promise<unknown>;

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  registerChannelHandlers();
});

describe("registerChannelHandlers", () => {
  it("registers all three channel IPC channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.CHANNELS_GET_BY_ID);
    expect(channels).toContain(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    expect(channels).toContain(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
  });
});

describe("CHANNELS_GET_BY_ID", () => {
  it("fetches Twitch channel by ID", async () => {
    const channel = { id: "123", login: "test" };
    vi.mocked(twitchClient.getChannelsById).mockResolvedValue([channel] as any);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_ID);
    const result = (await handler({}, { platform: "twitch", channelId: "123" })) as any;

    expect(result).toEqual({ success: true, data: channel });
    expect(twitchClient.getChannelsById).toHaveBeenCalledWith(["123"]);
  });

  it("returns null data when Twitch channel not found", async () => {
    vi.mocked(twitchClient.getChannelsById).mockResolvedValue([]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_ID);
    const result = (await handler({}, { platform: "twitch", channelId: "999" })) as any;

    expect(result).toEqual({ success: true, data: null });
  });

  it("fetches Kick channel by ID", async () => {
    const channel = { id: "456", slug: "kickuser" };
    vi.mocked(kickClient.getChannel).mockResolvedValue(channel as any);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_ID);
    const result = (await handler({}, { platform: "kick", channelId: "456" })) as any;

    expect(result).toEqual({ success: true, data: channel });
    expect(kickClient.getChannel).toHaveBeenCalledWith("456");
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(twitchClient.getChannelsById).mockRejectedValue(new Error("API down"));

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_ID);
    const result = (await handler({}, { platform: "twitch", channelId: "123" })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toBe("API down");
  });
});

describe("CHANNELS_GET_BY_USERNAME", () => {
  it("fetches Twitch channel by login via GQL", async () => {
    const channel = { id: "123", login: "testuser" };
    vi.mocked(twitchClient.getChannelByLogin).mockResolvedValue(channel as any);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = (await handler({}, { platform: "twitch", username: "testuser" })) as any;

    expect(result).toEqual({ success: true, data: channel });
    expect(twitchClient.getChannelByLogin).toHaveBeenCalledWith("testuser");
  });

  it("fetches Kick channel by slug", async () => {
    const channel = { id: "456", slug: "kickuser" };
    vi.mocked(kickClient.getChannel).mockResolvedValue(channel as any);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = (await handler({}, { platform: "kick", username: "kickuser" })) as any;

    expect(result).toEqual({ success: true, data: channel });
    expect(kickClient.getChannel).toHaveBeenCalledWith("kickuser");
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(kickClient.getChannel).mockRejectedValue(new Error("not found"));

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = (await handler({}, { platform: "kick", username: "x" })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toBe("not found");
  });
});

describe("CHANNELS_GET_FOLLOWED", () => {
  it("returns followed channels when Twitch is authenticated", async () => {
    const channels = [{ id: "1" }, { id: "2" }];
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchClient.getAllFollowedChannels).mockResolvedValue(channels as any);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = (await handler({}, { platform: "twitch" })) as any;

    expect(result).toEqual({ success: true, data: channels });
  });

  it("returns empty array when Twitch is not authenticated", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(false);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = (await handler({}, { platform: "twitch" })) as any;

    expect(result).toEqual({ success: true, data: [] });
    expect(twitchClient.getAllFollowedChannels).not.toHaveBeenCalled();
  });

  it("returns empty array for Kick (not supported)", async () => {
    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = (await handler({}, { platform: "kick" })) as any;

    expect(result).toEqual({ success: true, data: [] });
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchClient.getAllFollowedChannels).mockRejectedValue(new Error("timeout"));

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = (await handler({}, { platform: "twitch" })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toBe("timeout");
  });
});
