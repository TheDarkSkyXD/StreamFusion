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
    getChannelsByBroadcasterIds: vi.fn(),
  },
}));

vi.mock("@/backend/services/storage-service", () => ({
  storageService: {
    getActiveFollowsByPlatform: vi.fn(),
    getLocalFollowsByPlatform: vi.fn(),
    updateLocalFollow: vi.fn(),
  },
}));

vi.mock("@/backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ipcMain } from "electron";

import { kickClient } from "@/backend/api/platforms/kick/kick-client";
import { twitchClient } from "@/backend/api/platforms/twitch/twitch-client";
import { registerChannelHandlers } from "@/backend/ipc/handlers/channel-handlers";
import { storageService } from "@/backend/services/storage-service";

type Handler = (event: unknown, params: unknown) => Promise<unknown>;

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([]);
  vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([]);
  registerChannelHandlers();
});

// Guards: CHANNELS_GET_BY_ID / CHANNELS_GET_BY_USERNAME / CHANNELS_GET_FOLLOWED IPC handlers — platform-discriminated routing (twitch → twitchClient, kick → kickClient), the {success, data}/{success, error} envelope contract, and the "Twitch not authenticated returns empty array (doesn't throw)" path. Wiring-only "registers all three channel IPC channels" assertion was removed in U20.c — getHandler() throws if a channel isn't registered, so the behavior tests below already pin the registration as a side-effect.

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

  it("returns verified Kick account follows from storage", async () => {
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "row-1",
        platform: "kick",
        channelId: "kick-1",
        channelName: "summit1g",
        displayName: "Summit1G",
        profileImage: "https://example.com/summit.jpg",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
    ]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = (await handler({}, { platform: "kick" })) as any;

    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          id: "kick-1",
          platform: "kick",
          username: "summit1g",
          displayName: "Summit1G",
          avatarUrl: "https://example.com/summit.jpg",
        }),
      ],
    });
  });

  it("repairs renamed Kick follow slugs before returning followed channels", async () => {
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "row-1",
        platform: "kick",
        channelId: "123",
        channelName: "old-slug",
        displayName: "Old Slug",
        profileImage: "",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
    ]);
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([
      {
        id: "123",
        platform: "kick",
        username: "new-slug",
        displayName: "New Slug",
        avatarUrl: "https://example.com/new.jpg",
        isLive: false,
        isVerified: false,
        isPartner: false,
      },
    ] as any);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = (await handler({}, { platform: "kick" })) as any;

    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          id: "123",
          platform: "kick",
          username: "new-slug",
          displayName: "New Slug",
          avatarUrl: "https://example.com/new.jpg",
        }),
      ],
    });
    expect(kickClient.getChannelsByBroadcasterIds).toHaveBeenCalledWith([123]);
    expect(storageService.updateLocalFollow).toHaveBeenCalledWith("row-1", {
      channelName: "new-slug",
      displayName: "New Slug",
      profileImage: "https://example.com/new.jpg",
    });
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
