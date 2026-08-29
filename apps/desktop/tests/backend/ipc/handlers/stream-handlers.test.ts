import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@shared/ipc-channels";
import { createIsolatedDatabaseTestLifecycle } from "../../../helpers/database-test-lifecycle";

vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  ipcMain: { handle: vi.fn() },
}));

const resolverMocks = vi.hoisted(() => ({ twitch: vi.fn(), kick: vi.fn() }));

vi.mock("@backend/api/platforms/twitch/twitch-client", () => ({
  twitchClient: {
    getTopStreams: vi.fn(),
    getStreamByLogin: vi.fn(),
    isAuthenticated: vi.fn(),
    getFollowedStreams: vi.fn(),
    getStreamsByLogins: vi.fn(),
  },
}));

vi.mock("@backend/api/platforms/kick/kick-client", () => ({
  kickClient: {
    getTopStreams: vi.fn(),
    getStreamsByCategory: vi.fn(),
    getStreamBySlug: vi.fn(),
    isAuthenticated: vi.fn(),
    getFollowedStreams: vi.fn(),
    getPublicStreamBySlug: vi.fn(),
    getPublicChannel: vi.fn(),
    getChannelsByBroadcasterIds: vi.fn(),
    getStreamsByBroadcasterIds: vi.fn(),
  },
}));

vi.mock("@backend/api/platforms/twitch/twitch-stream-resolver", () => {
  return {
    TwitchStreamResolver: class {
      getStreamPlaybackUrl = resolverMocks.twitch;
    },
  };
});
vi.mock("@backend/api/platforms/kick/kick-stream-resolver", () => {
  return {
    KickStreamResolver: class {
      getStreamPlaybackUrl = resolverMocks.kick;
    },
  };
});
vi.mock("@backend/api/unified/registry", () => ({
  clients: {
    for: vi.fn(),
    all: vi.fn(),
    register: vi.fn(),
  },
}));

vi.mock("@backend/services/storage-service", () => ({
  storageService: {
    getActiveFollowsByPlatform: vi.fn(),
    getLocalFollowsByPlatform: vi.fn(),
    updateLocalFollow: vi.fn(),
    getKickFollowedStreamsCache: vi.fn(),
    saveKickFollowedStreamsCache: vi.fn(),
  },
}));

vi.mock("@backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { app, ipcMain } from "electron";

import { logger } from "@backend/logging/logger";
import { kickClient } from "@backend/api/platforms/kick/kick-client";
import { isKickRateLimitError } from "@backend/api/platforms/kick/kick-error-classification";
import { twitchClient } from "@backend/api/platforms/twitch/twitch-client";
import { clients } from "@backend/api/unified/registry";
import {
  KICK_STARTUP_FOLLOWED_STREAM_SCAN_GRACE_MS,
  registerStreamHandlers,
  shouldDeferKickStartupFollowedStreamScan,
} from "@backend/ipc/handlers/stream-handlers";
import { dbService } from "@backend/services/database-service";
import { storageService } from "@backend/services/storage-service";
import type { UnifiedStream } from "@shared/platform-types";
import type { IPlatformReader } from "@backend/api/unified/platform-reader";
import type { LocalFollow } from "@shared/auth-types";

type StreamListResult = {
  success: boolean;
  data: UnifiedStream[];
  cursor?: string;
  platform?: string;
  error?: string;
};
type StreamChannelResult = { success: boolean; data: UnifiedStream | null; error?: string };
type PlaybackResult = { success: boolean; data: { url: string }; error?: string };
type Handler<T> = (event: unknown, params?: unknown) => Promise<T>;

function stream(id: string, platform: "twitch" | "kick", viewerCount: number): UnifiedStream {
  return {
    id,
    platform,
    channelId: `${id}-channel`,
    channelName: `${id}-channel`,
    channelDisplayName: `${id}-channel`,
    channelAvatar: "",
    title: id,
    viewerCount,
    thumbnailUrl: "",
    isLive: true,
    startedAt: null,
    language: "en",
    tags: [],
  };
}

function channel(id: string, username: string) {
  return {
    id,
    platform: "kick" as const,
    username,
    displayName: username,
    avatarUrl: "",
    isLive: false,
    isVerified: false,
    isPartner: false,
  };
}

function reader(platform: "twitch" | "kick", result: UnifiedStream[] | Error): IPlatformReader {
  return {
    platform,
    isAuthenticated: () => false,
    getTopStreams: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return { data: result };
    }),
  };
}

function follow(channelName: string, channelId = channelName): LocalFollow {
  return {
    id: `${channelId}:follow`,
    platform: "kick",
    channelId,
    channelName,
    displayName: channelName,
    profileImage: "",
    followedAt: "2026-01-01T00:00:00.000Z",
    source: "guest",
  };
}

const databaseLifecycle = createIsolatedDatabaseTestLifecycle(
  dbService,
  (directory) => vi.mocked(app.getPath).mockReturnValue(directory),
  "streamfusion-stream-handlers-"
);

function getHandler(channel: typeof IPC_CHANNELS.STREAMS_GET_TOP): Handler<StreamListResult>;
function getHandler(
  channel: typeof IPC_CHANNELS.STREAMS_GET_BY_CATEGORY
): Handler<StreamListResult>;
function getHandler(channel: typeof IPC_CHANNELS.STREAMS_GET_FOLLOWED): Handler<StreamListResult>;
function getHandler(
  channel: typeof IPC_CHANNELS.STREAMS_GET_BY_CHANNEL
): Handler<StreamChannelResult>;
function getHandler(channel: typeof IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL): Handler<PlaybackResult>;
function getHandler<T>(channel: string): Handler<T> {
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return (event, params) => Promise.resolve(Reflect.apply(call[1], undefined, [event, params]));
}

beforeEach(() => {
  vi.clearAllMocks();
  databaseLifecycle.initialize();
  vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([]);
  vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([]);
  vi.mocked(storageService.getKickFollowedStreamsCache).mockReturnValue(undefined);
  vi.mocked(kickClient.getStreamsByBroadcasterIds).mockResolvedValue([]);
  registerStreamHandlers();
});

afterEach(() => {
  databaseLifecycle.dispose();
});

describe("registerStreamHandlers", () => {
  it("registers all five stream IPC channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.STREAMS_GET_TOP);
    expect(channels).toContain(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY);
    expect(channels).toContain(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    expect(channels).toContain(IPC_CHANNELS.STREAMS_GET_BY_CHANNEL);
    expect(channels).toContain(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
  });
});

// Guards: a cross-platform limit caps the merged result, not each provider independently.
describe("STREAMS_GET_TOP", () => {
  it("returns single platform result when platform is specified", async () => {
    const twitchReader = reader("twitch", [stream("1", "twitch", 100)]);
    vi.mocked(twitchReader.getTopStreams).mockResolvedValue({
      data: [stream("1", "twitch", 100)],
      cursor: "c1",
    });
    vi.mocked(clients.for).mockReturnValue(twitchReader);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_TOP);
    const result = await handler({}, { platform: "twitch" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([expect.objectContaining({ id: "1", viewerCount: 100 })]);
    expect(result.cursor).toBe("c1");
  });

  it("merges and sorts by viewerCount when both platforms requested", async () => {
    const twitchReader = reader("twitch", [stream("t1", "twitch", 50)]);
    const kickReader = reader("kick", [stream("k1", "kick", 200)]);
    vi.mocked(clients.all).mockReturnValue([twitchReader, kickReader]);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_TOP);
    const result = await handler({}, {});

    expect(result.success).toBe(true);
    expect(result.data[0].id).toBe("k1");
    expect(result.data[1].id).toBe("t1");
  });

  it("applies the requested limit after merging both platforms", async () => {
    const twitchReader = reader("twitch", [
      stream("t1", "twitch", 300),
      stream("t2", "twitch", 100),
    ]);
    const kickReader = reader("kick", [stream("k1", "kick", 200), stream("k2", "kick", 50)]);
    vi.mocked(clients.all).mockReturnValue([twitchReader, kickReader]);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_TOP);
    const result = await handler({}, { limit: 2 });

    expect(result.data.map((item) => item.id)).toEqual(["t1", "k1"]);
  });

  it("returns partial results when one platform throws", async () => {
    const twitchReader = reader("twitch", new Error("twitch down"));
    const kickReader = reader("kick", [stream("k1", "kick", 200)]);
    vi.mocked(clients.all).mockReturnValue([twitchReader, kickReader]);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_TOP);
    const result = await handler({}, {});

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("k1");
  });
});

describe("STREAMS_GET_BY_CATEGORY", () => {
  it("fetches from both platforms when no platform specified", async () => {
    vi.mocked(twitchClient.getTopStreams).mockResolvedValue({
      data: [stream("t1", "twitch", 50)],
      cursor: "tc",
    });
    vi.mocked(kickClient.getStreamsByCategory).mockResolvedValue({
      data: [stream("k1", "kick", 200)],
      cursor: "kc",
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY);
    const result = await handler({}, { categoryId: "123" });

    expect(result.success).toBe(true);
    expect(result.data[0].viewerCount).toBe(200);
    expect(result.data[1].viewerCount).toBe(50);
  });

  it("fetches only Twitch when platform=twitch", async () => {
    vi.mocked(twitchClient.getTopStreams).mockResolvedValue({
      data: [stream("t1", "twitch", 50)],
      cursor: "tc",
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY);
    const result = await handler({}, { categoryId: "123", platform: "twitch" });

    expect(result.success).toBe(true);
    expect(result.platform).toBe("twitch");
    expect(kickClient.getStreamsByCategory).not.toHaveBeenCalled();
  });

  it("fetches only Kick when platform=kick", async () => {
    vi.mocked(kickClient.getStreamsByCategory).mockResolvedValue({
      data: [stream("k1", "kick", 100)],
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY);
    const result = await handler({}, { categoryId: "123", platform: "kick" });

    expect(result.success).toBe(true);
    expect(result.platform).toBe("kick");
    expect(twitchClient.getTopStreams).not.toHaveBeenCalled();
  });

  it("returns consistent shape when single-platform fetch fails", async () => {
    vi.mocked(twitchClient.getTopStreams).mockRejectedValue(new Error("fail"));

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY);
    const result = await handler({}, { categoryId: "123", platform: "twitch" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.platform).toBe("twitch");
  });
});

describe("STREAMS_GET_BY_CHANNEL", () => {
  it("fetches Twitch stream by login", async () => {
    const streamResult = stream("s1", "twitch", 1);
    vi.mocked(twitchClient.getStreamByLogin).mockResolvedValue(streamResult);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CHANNEL);
    const result = await handler({}, { platform: "twitch", username: "test" });

    expect(result).toEqual({ success: true, data: streamResult });
  });

  it("fetches Kick stream by slug", async () => {
    const streamResult = stream("s2", "kick", 1);
    vi.mocked(kickClient.getStreamBySlug).mockResolvedValue(streamResult);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CHANNEL);
    const result = await handler({}, { platform: "kick", username: "kickuser" });

    expect(result).toEqual({ success: true, data: streamResult });
    expect(kickClient.getStreamBySlug).toHaveBeenCalledWith("kickuser", {
      freshStatus: true,
    });
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(twitchClient.getStreamByLogin).mockRejectedValue(new Error("offline"));

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CHANNEL);
    const result = await handler({}, { platform: "twitch", username: "x" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("offline");
  });

  it("returns cooldown metadata without logging expected Kick rate limits as errors", async () => {
    const rateLimit = Object.assign(new Error("Kick API rate limit active; retry after 60s"), {
      name: "KickRateLimitError",
      retryAfterMs: 60_000,
    });
    vi.mocked(kickClient.getStreamBySlug).mockRejectedValue(rateLimit);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CHANNEL);
    const result = await handler({}, { platform: "kick", username: "kickuser" });

    expect(result).toEqual({
      success: false,
      error: "Kick API rate limit active; retry after 60s",
      retryAfterMs: 60_000,
    });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      "IPC:Stream",
      "Kick stream status refresh paused for API cooldown",
      { username: "kickuser", retryAfterMs: 60_000 }
    );
  });
});

// Guards: overlapping followed-status consumers share one scan and a short-lived result without changing response data.
describe("STREAMS_GET_FOLLOWED", () => {
  it("classifies Kick rate-limit failures without matching unrelated errors", () => {
    expect(isKickRateLimitError(new Error("Request failed with status 429"))).toBe(true);
    expect(isKickRateLimitError(new Error("Kick rate limit exceeded"))).toBe(true);
    expect(isKickRateLimitError(new Error("Request failed with status 500"))).toBe(false);
  });

  it("does not fan a rate-limited bulk status request out across every followed slug", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation((platform) =>
      platform === "kick"
        ? [
            { ...follow("kick-one"), channelId: "101" },
            { ...follow("kick-two"), channelId: "102" },
          ]
        : []
    );
    vi.mocked(kickClient.getStreamsByBroadcasterIds).mockRejectedValue(
      new Error("Request failed with status 429")
    );
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([
      channel("101", "kick-one"),
      channel("102", "kick-two"),
    ]);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = await handler({}, { platform: "kick" });

    expect(result).toEqual({ success: true, platform: "kick", data: [] });
    expect(kickClient.getPublicStreamBySlug).not.toHaveBeenCalled();
  });

  it("reuses a recent persisted Kick snapshot without making restart network calls", async () => {
    const cachedStream = stream("cached-kick", "kick", 42);
    vi.mocked(storageService.getKickFollowedStreamsCache).mockReturnValue({
      cachedAt: Date.now(),
      streams: [cachedStream],
    });
    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation((platform) =>
      platform === "kick" ? [follow("cached-kick")] : []
    );

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = await handler({}, { platform: "kick" });

    expect(result.data).toEqual([cachedStream]);
    expect(kickClient.getFollowedStreams).not.toHaveBeenCalled();
    expect(kickClient.getStreamsByBroadcasterIds).not.toHaveBeenCalled();
    expect(kickClient.getPublicStreamBySlug).not.toHaveBeenCalled();
  });

  it("keeps startup Kick followed-stream scans enabled", () => {
    expect(shouldDeferKickStartupFollowedStreamScan(undefined, 1000, 0)).toBe(false);
    expect(shouldDeferKickStartupFollowedStreamScan("kick", 1000, 0)).toBe(false);
    expect(shouldDeferKickStartupFollowedStreamScan("twitch", 1000, 0)).toBe(false);
    expect(
      shouldDeferKickStartupFollowedStreamScan(
        "kick",
        KICK_STARTUP_FOLLOWED_STREAM_SCAN_GRACE_MS + 1,
        0
      )
    ).toBe(false);
  });

  it("scans all local Kick follows so requested result limits do not hide live channels", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation((platform) =>
      platform === "kick" ? [follow("kick-one"), follow("kick-two"), follow("kick-three")] : []
    );
    vi.mocked(kickClient.getPublicStreamBySlug).mockResolvedValue(null);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = await handler({}, { platform: "kick", limit: 2 });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(kickClient.getPublicStreamBySlug).toHaveBeenCalledTimes(3);
    expect(kickClient.getPublicStreamBySlug).toHaveBeenNthCalledWith(
      1,
      "kick-one",
      0,
      expect.any(AbortSignal)
    );
    expect(kickClient.getPublicStreamBySlug).toHaveBeenNthCalledWith(
      2,
      "kick-two",
      60,
      expect.any(AbortSignal)
    );
    expect(kickClient.getPublicStreamBySlug).toHaveBeenNthCalledWith(
      3,
      "kick-three",
      120,
      expect.any(AbortSignal)
    );
  });

  it("repairs renamed Kick follow slugs before scanning live streams", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation((platform) =>
      platform === "kick"
        ? [
            {
              id: "follow-1",
              platform: "kick",
              channelId: "123",
              channelName: "old-slug",
              displayName: "Old Slug",
              profileImage: "",
              followedAt: "2026-01-01T00:00:00.000Z",
              source: "guest",
            },
          ]
        : []
    );
    const renamedChannel = {
      ...channel("123", "new-slug"),
      displayName: "New Slug",
      avatarUrl: "https://example.com/new.jpg",
      kickUserId: "123",
    };
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([renamedChannel]);
    vi.mocked(kickClient.getPublicChannel).mockResolvedValue(renamedChannel);
    vi.mocked(kickClient.getStreamsByBroadcasterIds).mockResolvedValue([
      stream("stream-123", "kick", 42),
    ]);
    vi.mocked(kickClient.getPublicStreamBySlug).mockResolvedValue(
      stream("legacy-stream-123", "kick", 42)
    );

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = await handler({}, { platform: "kick" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([expect.objectContaining({ id: "stream-123" })]);
    expect(kickClient.getChannelsByBroadcasterIds).toHaveBeenCalledWith([123]);
    expect(kickClient.getStreamsByBroadcasterIds).toHaveBeenCalledWith([123]);
    expect(storageService.updateLocalFollow).toHaveBeenCalledWith("follow-1", {
      channelName: "new-slug",
      displayName: "New Slug",
      profileImage: "https://example.com/new.jpg",
    });
    expect(kickClient.getPublicStreamBySlug).not.toHaveBeenCalled();
  });

  it("shares concurrent and immediately repeated Kick followed-stream scans", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation((platform) =>
      platform === "kick" ? [follow("kick-one"), follow("kick-two")] : []
    );

    const pending: Array<{
      slug: string;
      signal: AbortSignal;
      resolve: (stream: UnifiedStream | null) => void;
    }> = [];
    vi.mocked(kickClient.getPublicStreamBySlug).mockImplementation((slug, _stagger, signal) => {
      return new Promise<UnifiedStream | null>((resolve, reject) => {
        if (!signal) throw new Error("Expected scan abort signal");
        const abortSignal = signal;
        abortSignal.addEventListener("abort", () => reject(new Error("AbortError")), {
          once: true,
        });
        pending.push({ slug, signal: abortSignal, resolve });
      });
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const first = handler({}, { platform: "kick" });
    await vi.waitFor(() => expect(pending).toHaveLength(2));

    const second = handler({}, { platform: "kick" });
    await Promise.resolve();
    expect(pending).toHaveLength(2);

    expect(pending[0].signal.aborted).toBe(false);
    expect(pending[1].signal.aborted).toBe(false);

    for (const item of pending) {
      item.resolve(stream(`${item.slug}-stream`, "kick", item.slug === "kick-one" ? 20 : 10));
    }

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(true);
    expect(firstResult.data.map((item) => item.id).sort()).toEqual([
      "kick-one-stream",
      "kick-two-stream",
    ]);
    expect(secondResult.data.map((item) => item.id).sort()).toEqual([
      "kick-one-stream",
      "kick-two-stream",
    ]);

    const cachedResult = await handler({}, { platform: "kick" });
    expect(pending).toHaveLength(2);
    expect(cachedResult.data).toEqual(firstResult.data);
  });

  it("merges and sorts by viewerCount when both platforms requested", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchClient.getFollowedStreams).mockResolvedValue({
      data: [stream("t1", "twitch", 50)],
      cursor: "tc",
    });
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([]);

    vi.mocked(kickClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickClient.getFollowedStreams).mockResolvedValue({
      data: [stream("k1", "kick", 200)],
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = await handler({}, {});

    expect(result.success).toBe(true);
    expect(result.data[0].viewerCount).toBe(200);
    expect(result.data[1].viewerCount).toBe(50);
  });

  it("returns empty array with success:true on outer catch", async () => {
    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation(() => {
      throw new Error("db corrupt");
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = await handler({}, { platform: "twitch" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("deduplicates streams by id between remote and local", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchClient.getFollowedStreams).mockResolvedValue({
      data: [stream("overlap", "twitch", 100)],
    });
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([follow("overlapuser")]);
    vi.mocked(twitchClient.getStreamsByLogins).mockResolvedValue({
      data: [stream("overlap", "twitch", 100)],
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = await handler({}, { platform: "twitch" });

    expect(result.success).toBe(true);
    const ids = result.data.map((s) => s.id);
    const uniqueIds = [...new Set(ids)];
    expect(ids.length).toBe(uniqueIds.length);
  });

  it("deduplicates Kick remote and public live results by broadcaster slug", async () => {
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickClient.getFollowedStreams).mockResolvedValue({
      data: [
        {
          ...stream("remote-live-id", "kick", 6300),
          channelId: "kick-user-id",
          channelName: "xqc",
        },
      ],
    });
    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation((platform) =>
      platform === "kick" ? [follow("xqc", "12345")] : []
    );
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([]);
    vi.mocked(kickClient.getStreamsByBroadcasterIds).mockResolvedValue([
      {
        ...stream("public-live-id", "kick", 6300),
        channelId: "kick-channel-id",
        channelName: "XQC",
      },
    ]);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = await handler({}, { platform: "kick" });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });
});

describe("STREAMS_GET_PLAYBACK_URL", () => {
  it("resolves Twitch playback URL", async () => {
    resolverMocks.twitch.mockResolvedValue({
      url: "https://twitch.tv/stream.m3u8",
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "twitch", channelSlug: "test" });

    expect(result.success).toBe(true);
    expect(result.data.url).toBe("https://twitch.tv/stream.m3u8");
  });

  it("resolves Kick playback URL", async () => {
    resolverMocks.kick.mockResolvedValue({
      url: "https://kick.com/stream.m3u8",
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "kick", channelSlug: "test" });

    expect(result.success).toBe(true);
    expect(result.data.url).toBe("https://kick.com/stream.m3u8");
  });

  it("repairs a renamed Kick follow slug and retries playback once", async () => {
    resolverMocks.kick
      .mockRejectedValueOnce(new Error("Channel not found for old-slug - renamed"))
      .mockResolvedValueOnce({
        url: "https://kick.com/repaired.m3u8",
      });
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "follow-1",
        platform: "kick",
        channelId: "123",
        channelName: "old-slug",
        displayName: "Old Slug",
        profileImage: "",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "guest",
      },
    ]);
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([
      { ...channel("123", "new-slug"), displayName: "New Slug" },
    ]);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "kick", channelSlug: "old-slug" });

    expect(result.success).toBe(true);
    expect(result.data.url).toBe("https://kick.com/repaired.m3u8");
    expect(resolverMocks.kick).toHaveBeenNthCalledWith(1, "old-slug");
    expect(resolverMocks.kick).toHaveBeenNthCalledWith(2, "new-slug");
    expect(storageService.updateLocalFollow).toHaveBeenCalledWith("follow-1", {
      channelName: "new-slug",
      displayName: "New Slug",
    });
  });

  it("returns error envelope on unsupported platform", async () => {
    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "youtube", channelSlug: "test" });

    expect(result.success).toBe(false);
  });
});
