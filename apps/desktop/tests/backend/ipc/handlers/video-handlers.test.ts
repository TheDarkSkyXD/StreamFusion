import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/api/platforms/twitch/twitch-stream-resolver", () => {
  const proto = {
    getVodPlaybackUrl: vi.fn(),
    getClipPlaybackUrl: vi.fn(),
  };
  function MockTwitchStreamResolver() {}
  MockTwitchStreamResolver.prototype = proto;
  return { TwitchStreamResolver: MockTwitchStreamResolver };
});

vi.mock("@/backend/api/platforms/kick/kick-stream-resolver", () => {
  const proto = {
    getVodPlaybackUrl: vi.fn(),
    getVideoMetadata: vi.fn(),
  };
  function MockKickStreamResolver() {}
  MockKickStreamResolver.prototype = proto;
  return { KickStreamResolver: MockKickStreamResolver };
});

vi.mock("@/backend/api/platforms/twitch/twitch-client", () => ({
  twitchClient: {
    getVideoById: vi.fn(),
    getVideosByChannel: vi.fn(),
    getVideosGameData: vi.fn(),
    getClipsByChannel: vi.fn(),
  },
}));

vi.mock("@/backend/api/platforms/kick/kick-client", () => ({
  kickClient: {
    getVideos: vi.fn(),
    getClips: vi.fn(),
  },
}));

vi.mock("@/backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ipcMain } from "electron";

import { kickClient } from "@/backend/api/platforms/kick/kick-client";
import { KickStreamResolver } from "@/backend/api/platforms/kick/kick-stream-resolver";
import { twitchClient } from "@/backend/api/platforms/twitch/twitch-client";
import { TwitchStreamResolver } from "@/backend/api/platforms/twitch/twitch-stream-resolver";
import { registerVideoHandlers } from "@/backend/ipc/handlers/video-handlers";

const twitchResolverProto = TwitchStreamResolver.prototype as any;
const kickResolverProto = KickStreamResolver.prototype as any;

type Handler = (event: unknown, params: unknown) => Promise<unknown>;

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  registerVideoHandlers();
});

describe("registerVideoHandlers", () => {
  it("registers all six video/clip IPC channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.VIDEOS_GET_PLAYBACK_URL);
    expect(channels).toContain(IPC_CHANNELS.VIDEOS_GET_METADATA);
    expect(channels).toContain(IPC_CHANNELS.VIDEOS_GET_BY_CHANNEL);
    expect(channels).toContain(IPC_CHANNELS.CLIPS_GET_BY_CHANNEL);
    expect(channels).toContain(IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL);
    expect(channels).toContain(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID);
  });
});

describe("VIDEOS_GET_PLAYBACK_URL", () => {
  it("resolves Twitch VOD playback URL", async () => {
    twitchResolverProto.getVodPlaybackUrl.mockResolvedValue({ url: "https://vod.twitch.tv/test.m3u8" });

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_PLAYBACK_URL);
    const result = (await handler({}, { platform: "twitch", videoId: "123" })) as any;

    expect(result.success).toBe(true);
    expect(result.data.url).toBe("https://vod.twitch.tv/test.m3u8");
  });

  it("resolves Kick VOD playback URL", async () => {
    kickResolverProto.getVodPlaybackUrl.mockResolvedValue({ url: "https://kick.com/vod.m3u8" });

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_PLAYBACK_URL);
    const result = (await handler({}, { platform: "kick", videoId: "456" })) as any;

    expect(result.success).toBe(true);
    expect(result.data.url).toBe("https://kick.com/vod.m3u8");
  });

  it("returns error for unsupported platform", async () => {
    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_PLAYBACK_URL);
    const result = (await handler({}, { platform: "youtube", videoId: "x" })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported platform");
  });

  it("returns error on resolver failure", async () => {
    twitchResolverProto.getVodPlaybackUrl.mockRejectedValue(new Error("not found"));

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_PLAYBACK_URL);
    const result = (await handler({}, { platform: "twitch", videoId: "bad" })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toBe("not found");
  });
});

describe("VIDEOS_GET_METADATA", () => {
  it("returns formatted Twitch video metadata", async () => {
    vi.mocked(twitchClient.getVideoById).mockResolvedValue({
      id: "v1",
      title: "Stream",
      channelId: "c1",
      channelName: "streamer",
      channelDisplayName: "Streamer",
      channelAvatar: "https://avatar.jpg",
      viewCount: 5000,
      duration: 3661,
      publishedAt: "2026-01-01T00:00:00Z",
      thumbnailUrl: "https://thumb.jpg",
      description: "desc",
      type: "archive",
    } as any);

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_METADATA);
    const result = (await handler({}, { platform: "twitch", videoId: "v1" })) as any;

    expect(result.success).toBe(true);
    expect(result.data.id).toBe("v1");
    expect(result.data.duration).toBe("1:01:01");
    expect(result.data.platform).toBe("twitch");
  });

  it("returns error when Twitch video not found", async () => {
    vi.mocked(twitchClient.getVideoById).mockResolvedValue(null);

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_METADATA);
    const result = (await handler({}, { platform: "twitch", videoId: "x" })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toBe("Video not found");
  });

  it("returns Kick video metadata from resolver", async () => {
    const metadata = { id: "k1", title: "Kick VOD" };
    kickResolverProto.getVideoMetadata.mockResolvedValue(metadata);

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_METADATA);
    const result = (await handler({}, { platform: "kick", videoId: "k1" })) as any;

    expect(result.success).toBe(true);
    expect(result.data).toBe(metadata);
  });

  it("returns error for unsupported platform", async () => {
    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_METADATA);
    const result = (await handler({}, { platform: "youtube", videoId: "x" })) as any;

    expect(result.success).toBe(false);
  });
});

describe("VIDEOS_GET_BY_CHANNEL", () => {
  it("returns mapped Twitch videos with game data", async () => {
    vi.mocked(twitchClient.getVideosByChannel).mockResolvedValue({
      data: [
        {
          id: "v1",
          title: "Stream 1",
          duration: 7200,
          viewCount: 1000,
          publishedAt: "2026-01-01T00:00:00Z",
          thumbnailUrl: "https://thumb.jpg",
        },
      ],
      cursor: "vc",
    } as any);
    vi.mocked(twitchClient.getVideosGameData).mockResolvedValue({
      v1: { id: "g1", name: "Valorant" },
    } as any);

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_CHANNEL);
    const result = (await handler({}, {
      platform: "twitch",
      channelName: "TestChannel",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].duration).toBe("2:00:00");
    expect(result.data[0].gameName).toBe("Valorant");
    expect(result.data[0].platform).toBe("twitch");
    expect(result.cursor).toBe("vc");
  });

  it("lowercases Twitch channel login for GQL", async () => {
    vi.mocked(twitchClient.getVideosByChannel).mockResolvedValue({
      data: [],
      cursor: undefined,
    } as any);
    vi.mocked(twitchClient.getVideosGameData).mockResolvedValue({});

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_CHANNEL);
    await handler({}, { platform: "twitch", channelName: "MyCHANNEL" });

    expect(twitchClient.getVideosByChannel).toHaveBeenCalledWith("mychannel", expect.anything());
  });

  it("sorts Twitch videos by views when sort=views", async () => {
    vi.mocked(twitchClient.getVideosByChannel).mockResolvedValue({
      data: [
        { id: "v1", title: "A", duration: 60, viewCount: 10, publishedAt: "2026-01-01T00:00:00Z", thumbnailUrl: "" },
        { id: "v2", title: "B", duration: 60, viewCount: 100, publishedAt: "2026-01-01T00:00:00Z", thumbnailUrl: "" },
      ],
      cursor: undefined,
    } as any);
    vi.mocked(twitchClient.getVideosGameData).mockResolvedValue({});

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_CHANNEL);
    const result = (await handler({}, {
      platform: "twitch",
      channelName: "test",
      sort: "views",
    })) as any;

    expect(result.data[0].id).toBe("v2");
  });

  it("returns Kick videos with client-side view sort", async () => {
    vi.mocked(kickClient.getVideos).mockResolvedValue({
      data: [
        { id: "k1", views: "50" },
        { id: "k2", views: "200" },
      ],
      cursor: "kc",
    } as any);

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_CHANNEL);
    const result = (await handler({}, {
      platform: "kick",
      channelName: "kickuser",
      sort: "views",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.data[0].id).toBe("k2");
  });

  it("returns error for unsupported platform", async () => {
    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_CHANNEL);
    const result = (await handler({}, {
      platform: "youtube",
      channelName: "test",
    })) as any;

    expect(result.success).toBe(false);
  });
});

describe("CLIPS_GET_PLAYBACK_URL", () => {
  it("resolves Twitch clip playback URL via GQL", async () => {
    twitchResolverProto.getClipPlaybackUrl.mockResolvedValue({
      url: "https://clips.twitch.tv/test.mp4",
    });

    const handler = getHandler(IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL);
    const result = (await handler({}, { platform: "twitch", clipId: "abc" })) as any;

    expect(result.success).toBe(true);
    expect(result.data.url).toBe("https://clips.twitch.tv/test.mp4");
  });

  it("returns Kick clip URL directly with hls format for .m3u8", async () => {
    const handler = getHandler(IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL);
    const result = (await handler({}, {
      platform: "kick",
      clipId: "k1",
      clipUrl: "https://kick.com/clip.m3u8",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.data.url).toBe("https://kick.com/clip.m3u8");
    expect(result.data.format).toBe("hls");
  });

  it("returns Kick clip URL with mp4 format for non-.m3u8 URLs", async () => {
    const handler = getHandler(IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL);
    const result = (await handler({}, {
      platform: "kick",
      clipId: "k1",
      clipUrl: "https://kick.com/clip.mp4",
    })) as any;

    expect(result.data.format).toBe("mp4");
  });

  it("returns error when Kick clip has no clipUrl", async () => {
    const handler = getHandler(IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL);
    const result = (await handler({}, { platform: "kick", clipId: "k1" })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("Clip URL required");
  });

  it("returns error for unsupported platform", async () => {
    const handler = getHandler(IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL);
    const result = (await handler({}, { platform: "youtube", clipId: "x" })) as any;

    expect(result.success).toBe(false);
  });
});

describe("VIDEOS_GET_BY_LIVESTREAM_ID", () => {
  it("finds matching VOD by livestream ID", async () => {
    vi.mocked(kickClient.getVideos).mockResolvedValue({
      data: [
        { id: "v1", livestreamId: "999", title: "Wrong VOD" },
        { id: "v2", livestreamId: "123", title: "Correct VOD", source: "https://vod.m3u8" },
      ],
      cursor: undefined,
    } as any);

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID);
    const result = (await handler({}, {
      channelSlug: "test",
      livestreamId: "123",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.data.id).toBe("v2");
    expect(result.data.title).toBe("Correct VOD");
  });

  it("paginates through multiple pages to find the VOD", async () => {
    vi.mocked(kickClient.getVideos)
      .mockResolvedValueOnce({
        data: [{ id: "v1", livestreamId: "other", title: "Page 1" }],
        cursor: "page2",
      } as any)
      .mockResolvedValueOnce({
        data: [{ id: "v2", livestreamId: "target", title: "Found", source: "https://vod.m3u8" }],
        cursor: undefined,
      } as any);

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID);
    const result = (await handler({}, {
      channelSlug: "test",
      livestreamId: "target",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.data.id).toBe("v2");
    expect(kickClient.getVideos).toHaveBeenCalledTimes(2);
  });

  it("returns error when VOD not found after exhausting pages", async () => {
    vi.mocked(kickClient.getVideos).mockResolvedValue({
      data: [{ id: "v1", livestreamId: "other" }],
      cursor: undefined,
    } as any);

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID);
    const result = (await handler({}, {
      channelSlug: "test",
      livestreamId: "nonexistent",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("VOD not found");
  });

  it("stops after maxAttempts (5 pages) to prevent infinite loops", async () => {
    vi.mocked(kickClient.getVideos).mockResolvedValue({
      data: [{ id: "v1", livestreamId: "other" }],
      cursor: "next",
    } as any);

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID);
    const result = (await handler({}, {
      channelSlug: "test",
      livestreamId: "never-found",
    })) as any;

    expect(result.success).toBe(false);
    expect(kickClient.getVideos).toHaveBeenCalledTimes(5);
  });

  it("returns error on API failure", async () => {
    vi.mocked(kickClient.getVideos).mockRejectedValue(new Error("network error"));

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID);
    const result = (await handler({}, {
      channelSlug: "test",
      livestreamId: "123",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toBe("network error");
  });

  it("matches live_stream_id field variant", async () => {
    vi.mocked(kickClient.getVideos).mockResolvedValue({
      data: [
        { id: "v1", live_stream_id: "123", title: "Matched", source: "https://vod.m3u8" },
      ],
      cursor: undefined,
    } as any);

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID);
    const result = (await handler({}, {
      channelSlug: "test",
      livestreamId: "123",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.data.id).toBe("v1");
  });

  it("returns empty data for empty video pages", async () => {
    vi.mocked(kickClient.getVideos).mockResolvedValue({
      data: [],
      cursor: undefined,
    } as any);

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID);
    const result = (await handler({}, {
      channelSlug: "test",
      livestreamId: "123",
    })) as any;

    expect(result.success).toBe(false);
  });
});
