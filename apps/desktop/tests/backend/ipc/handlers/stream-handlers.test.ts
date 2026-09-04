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
    platform: "twitch",
    getTopStreams: vi.fn(),
    getStreamsByCategory: vi.fn(),
    getStreamByLogin: vi.fn(),
    isAuthenticated: vi.fn(),
    getFollowedStreamAccess: vi.fn(),
    getFollowedStreams: vi.fn(),
    getStreamsByLogins: vi.fn(),
  },
}));

vi.mock("@backend/api/platforms/kick/kick-client", () => ({
  kickClient: {
    platform: "kick",
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
import { registerStreamHandlers } from "@backend/ipc/handlers/stream-handlers";
import { dbService } from "@backend/services/database-service";
import { storageService } from "@backend/services/storage-service";
import type { UnifiedStream } from "@shared/platform-types";
import type { IPlatformReader } from "@streamfusion/core/discovery";
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

function reader(
  platform: "twitch" | "kick",
  result: UnifiedStream[] | Error
): IPlatformReader<UnifiedStream> {
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

let topReaders: Readonly<Record<"twitch" | "kick", IPlatformReader<UnifiedStream>>>;

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
  vi.mocked(twitchClient.getFollowedStreamAccess).mockImplementation(async () =>
    twitchClient.isAuthenticated() ? { kind: "ready" } : { kind: "guest" }
  );
  vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([]);
  vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([]);
  vi.mocked(storageService.getKickFollowedStreamsCache).mockReturnValue(undefined);
  vi.mocked(kickClient.getStreamsByBroadcasterIds).mockResolvedValue([]);
  topReaders = {
    twitch: reader("twitch", []),
    kick: reader("kick", []),
  };
  registerStreamHandlers({
    readers: topReaders,
    followedReaders: { twitch: twitchClient, kick: kickClient },
    categoryReaders: { twitch: twitchClient, kick: kickClient },
  });
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

// Guards: raw top-stream payloads are validated before platform adapters are selected.
// Guards: a cross-platform page size applies after merging, not independently to each provider.
// Guards: top-stream discovery uses the explicitly composed Core reader ports for both Platforms.
describe("STREAMS_GET_TOP", () => {
  it("rejects invalid payloads before selecting a platform client", async () => {
    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_TOP);

    const result = await handler({}, { platform: "youtube", limit: 0, unexpected: true });

    expect(result).toEqual({
      success: false,
      error: "Invalid top-stream request",
      providers: { twitch: "failed", kick: "failed" },
    });
    expect(topReaders.twitch.getTopStreams).not.toHaveBeenCalled();
    expect(topReaders.kick.getTopStreams).not.toHaveBeenCalled();
  });

  it("returns single platform result when platform is specified", async () => {
    vi.mocked(topReaders.twitch.getTopStreams).mockResolvedValue({
      data: [stream("1", "twitch", 100)],
      cursor: "c1",
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_TOP);
    const result = await handler({}, { platform: "twitch" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([expect.objectContaining({ id: "1", viewerCount: 100 })]);
    expect(result.cursor).toBe("c1");
    expect(topReaders.twitch.getTopStreams).toHaveBeenCalledWith({
      limit: 20,
      cursor: undefined,
      categoryId: undefined,
      language: undefined,
    });
    expect(topReaders.kick.getTopStreams).not.toHaveBeenCalled();
  });

  it("merges and sorts by viewerCount when both platforms requested", async () => {
    vi.mocked(topReaders.twitch.getTopStreams).mockResolvedValue({
      data: [stream("t1", "twitch", 50)],
    });
    vi.mocked(topReaders.kick.getTopStreams).mockResolvedValue({
      data: [stream("k1", "kick", 200)],
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_TOP);
    const result = await handler({}, {});

    expect(result.success).toBe(true);
    expect(result.data[0].id).toBe("k1");
    expect(result.data[1].id).toBe("t1");
  });

  it("applies the requested limit after merging both platforms", async () => {
    vi.mocked(topReaders.twitch.getTopStreams).mockResolvedValue({
      data: [stream("t1", "twitch", 300), stream("t2", "twitch", 100)],
    });
    vi.mocked(topReaders.kick.getTopStreams).mockResolvedValue({
      data: [stream("k1", "kick", 200), stream("k2", "kick", 50)],
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_TOP);
    const result = await handler({}, { limit: 2 });

    expect(result.data.map((item) => item.id)).toEqual(["t1", "k1"]);
  });

  it("returns partial results when one platform throws", async () => {
    vi.mocked(topReaders.twitch.getTopStreams).mockRejectedValue(new Error("twitch down"));
    vi.mocked(topReaders.kick.getTopStreams).mockResolvedValue({
      data: [stream("k1", "kick", 200)],
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_TOP);
    const result = await handler({}, {});

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("k1");
  });
});

describe("STREAMS_GET_BY_CATEGORY", () => {
  it("rejects a category request with neither an id nor a fallback name", async () => {
    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY);

    const result = await handler({}, { categoryId: "   ", limit: 20 });

    expect(result).toEqual({
      success: false,
      error: "Invalid category-stream request",
      providers: { twitch: "failed", kick: "failed" },
    });
    expect(twitchClient.getStreamsByCategory).not.toHaveBeenCalled();
    expect(kickClient.getStreamsByCategory).not.toHaveBeenCalled();
  });

  it("fetches from both platforms when no platform specified", async () => {
    vi.mocked(twitchClient.getStreamsByCategory).mockResolvedValue({
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
    vi.mocked(twitchClient.getStreamsByCategory).mockResolvedValue({
      data: [stream("t1", "twitch", 50)],
      cursor: "tc",
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY);
    const result = await handler({}, { categoryId: "123", platform: "twitch" });

    expect(result.success).toBe(true);
    expect(result.platform).toBe("twitch");
    expect(kickClient.getStreamsByCategory).not.toHaveBeenCalled();
    expect(twitchClient.getStreamsByCategory).toHaveBeenCalledWith("123", {
      limit: 20,
      cursor: undefined,
      categoryName: undefined,
      language: undefined,
    });
  });

  it("fetches only Kick when platform=kick", async () => {
    vi.mocked(kickClient.getStreamsByCategory).mockResolvedValue({
      data: [stream("k1", "kick", 100)],
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY);
    const result = await handler({}, { categoryId: "123", platform: "kick" });

    expect(result.success).toBe(true);
    expect(result.platform).toBe("kick");
    expect(twitchClient.getStreamsByCategory).not.toHaveBeenCalled();
  });

  it("reports a failed provider when a single-platform fetch fails", async () => {
    vi.mocked(twitchClient.getStreamsByCategory).mockRejectedValue(new Error("fail"));

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY);
    const result = await handler({}, { categoryId: "123", platform: "twitch" });

    expect(result).toEqual({
      success: false,
      error: "twitch category streams are unavailable",
      platform: "twitch",
      providers: { twitch: "failed" },
    });
  });
});

describe("STREAMS_GET_BY_CHANNEL", () => {
  it("rejects blank channel identities before loading a provider", async () => {
    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CHANNEL);

    const result = await handler({}, { platform: "kick", username: "   " });

    expect(result).toEqual({ success: false, error: "Invalid stream-channel request" });
    expect(kickClient.getStreamBySlug).not.toHaveBeenCalled();
    expect(twitchClient.getStreamByLogin).not.toHaveBeenCalled();
  });

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
// Guards: a restart snapshot is fallback evidence, never proof that the currently followed channels are still offline.
// Guards: numeric Kick follow ids that the official channel API cannot resolve fall back to slug status checks.
// Guards: authenticated Twitch followed-live pagination is exhausted so the returned collection has no arbitrary cap.
// Guards: stale Twitch credentials never enter Helix and local GQL follows remain available.
// Guards: obsolete limit/cursor fields are rejected so result caps cannot silently return through IPC.
describe("STREAMS_GET_FOLLOWED", () => {
  it("classifies Kick rate-limit failures without matching unrelated errors", () => {
    expect(isKickRateLimitError(new Error("Request failed with status 429"))).toBe(true);
    expect(isKickRateLimitError(new Error("Kick rate limit exceeded"))).toBe(true);
    expect(isKickRateLimitError(new Error("Request failed with status 500"))).toBe(false);
  });

  it("rejects obsolete followed-stream caps at the IPC boundary", async () => {
    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);

    const result = await handler({}, { platform: "kick", limit: 20 });

    expect(result).toEqual({
      success: false,
      error: "Invalid followed-stream request",
      providers: { twitch: "failed", kick: "failed" },
    });
    expect(kickClient.getFollowedStreams).not.toHaveBeenCalled();
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

    expect(result).toEqual({
      success: false,
      error: "kick followed streams are rate limited",
      platform: "kick",
      providers: { kick: "failed" },
    });
    expect(kickClient.getPublicStreamBySlug).not.toHaveBeenCalled();
  });

  it("refreshes live status instead of treating a recent restart snapshot as current", async () => {
    const cachedStream = stream("cached-kick", "kick", 42);
    const currentStream = stream("current-kick", "kick", 84);
    vi.mocked(storageService.getKickFollowedStreamsCache).mockReturnValue({
      cachedAt: Date.now(),
      streams: [cachedStream],
    });
    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation((platform) =>
      platform === "kick" ? [follow("current-kick")] : []
    );
    vi.mocked(kickClient.getPublicStreamBySlug).mockResolvedValue(currentStream);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = await handler({}, { platform: "kick" });

    expect(result.data).toEqual([currentStream]);
    expect(kickClient.getPublicStreamBySlug).toHaveBeenCalledWith(
      "current-kick",
      0,
      expect.any(AbortSignal)
    );
  });

  it("falls back to a slug status check when a numeric follow id cannot be resolved", async () => {
    const currentStream = stream("currently-live", "kick", 84);
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation((platform) =>
      platform === "kick" ? [follow("currently-live", "999")] : []
    );
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([]);
    vi.mocked(kickClient.getStreamsByBroadcasterIds).mockResolvedValue([]);
    vi.mocked(kickClient.getPublicStreamBySlug).mockResolvedValue(currentStream);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = await handler({}, { platform: "kick" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([currentStream]);
    expect(kickClient.getPublicStreamBySlug).toHaveBeenCalledWith(
      "currently-live",
      0,
      expect.any(AbortSignal)
    );
  });

  it("scans all local Kick follows", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation((platform) =>
      platform === "kick" ? [follow("kick-one"), follow("kick-two"), follow("kick-three")] : []
    );
    vi.mocked(kickClient.getPublicStreamBySlug).mockResolvedValue(null);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = await handler({}, { platform: "kick" });

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

  it("returns every authenticated Twitch followed stream across API pages", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchClient.getFollowedStreams)
      .mockResolvedValueOnce({
        data: [stream("twitch-page-one", "twitch", 50)],
        cursor: "next-page",
      })
      .mockResolvedValueOnce({
        data: [stream("twitch-page-two", "twitch", 25)],
      });
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([]);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = await handler({}, { platform: "twitch" });

    expect(result.success).toBe(true);
    expect(result.data.map((item) => item.id)).toEqual(["twitch-page-one", "twitch-page-two"]);
    expect(twitchClient.getFollowedStreams).toHaveBeenNthCalledWith(1, {
      first: 100,
      after: undefined,
    });
    expect(twitchClient.getFollowedStreams).toHaveBeenNthCalledWith(2, {
      first: 100,
      after: "next-page",
    });
  });

  it("skips Helix when stored Twitch credentials cannot pass async validation", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchClient.getFollowedStreamAccess).mockResolvedValue({ kind: "unavailable" });
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      { ...follow("local-twitch"), platform: "twitch" },
    ]);
    vi.mocked(twitchClient.getStreamsByLogins).mockResolvedValue({
      data: [stream("local-live", "twitch", 42)],
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = await handler({}, { platform: "twitch" });

    expect(twitchClient.getFollowedStreams).not.toHaveBeenCalled();
    expect(twitchClient.getStreamsByLogins).toHaveBeenCalledWith(["local-twitch"]);
    expect(result.data.map((item) => item.id)).toEqual(["local-live"]);
  });

  it("reports provider failure on an outer followed-stream error", async () => {
    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation(() => {
      throw new Error("db corrupt");
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = await handler({}, { platform: "twitch" });

    expect(result).toEqual({
      success: false,
      error: "db corrupt",
      platform: "twitch",
      providers: { twitch: "failed" },
    });
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
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([channel("12345", "xqc")]);
    vi.mocked(kickClient.getPublicChannel).mockResolvedValue(null);
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

// Guards: an explicit Kick playback recovery bypasses the main-process URL cache.
// Guards: ordinary playback and Twitch recovery preserve their existing resolver behavior.
// Guards: malformed playback requests are rejected before either resolver runs.
describe("STREAMS_GET_PLAYBACK_URL", () => {
  it("resolves Twitch playback URL", async () => {
    resolverMocks.twitch.mockResolvedValue({
      url: "https://twitch.tv/stream.m3u8",
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "twitch", channelSlug: "test", intent: "play" });

    expect(result.success).toBe(true);
    expect(result.data.url).toBe("https://twitch.tv/stream.m3u8");
    expect(resolverMocks.twitch).toHaveBeenCalledWith("test");
  });

  it("keeps Twitch recovery on the existing resolver contract", async () => {
    resolverMocks.twitch.mockResolvedValue({
      url: "https://twitch.tv/refreshed.m3u8",
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
    const result = await handler(
      {},
      { platform: "twitch", channelSlug: "test", intent: "recover" }
    );

    expect(result.success).toBe(true);
    expect(resolverMocks.twitch).toHaveBeenCalledWith("test");
  });

  it("resolves Kick playback URL", async () => {
    resolverMocks.kick.mockResolvedValue({
      url: "https://kick.com/stream.m3u8",
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "kick", channelSlug: "test", intent: "play" });

    expect(result.success).toBe(true);
    expect(result.data.url).toBe("https://kick.com/stream.m3u8");
    expect(resolverMocks.kick).toHaveBeenCalledWith("test");
  });

  it("forces a fresh Kick URL for an explicit playback recovery", async () => {
    resolverMocks.kick.mockResolvedValue({
      url: "https://kick.com/refreshed.m3u8",
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "kick", channelSlug: "test", intent: "recover" });

    expect(result.success).toBe(true);
    expect(resolverMocks.kick).toHaveBeenCalledWith("test", { forceRefresh: true });
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
    const result = await handler({}, { platform: "kick", channelSlug: "old-slug", intent: "play" });

    expect(result.success).toBe(true);
    expect(result.data.url).toBe("https://kick.com/repaired.m3u8");
    expect(resolverMocks.kick).toHaveBeenNthCalledWith(1, "old-slug");
    expect(resolverMocks.kick).toHaveBeenNthCalledWith(2, "new-slug");
    expect(storageService.updateLocalFollow).toHaveBeenCalledWith("follow-1", {
      channelName: "new-slug",
      displayName: "New Slug",
    });
  });

  it("keeps forced refresh enabled while repairing a renamed Kick slug", async () => {
    resolverMocks.kick
      .mockRejectedValueOnce(new Error("Channel not found for old-slug - renamed"))
      .mockResolvedValueOnce({ url: "https://kick.com/repaired-fresh.m3u8" });
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      follow("old-slug", "123"),
    ]);
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([
      { ...channel("123", "new-slug"), displayName: "New Slug" },
    ]);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
    const result = await handler(
      {},
      { platform: "kick", channelSlug: "old-slug", intent: "recover" }
    );

    expect(result.success).toBe(true);
    expect(resolverMocks.kick).toHaveBeenNthCalledWith(1, "old-slug", {
      forceRefresh: true,
    });
    expect(resolverMocks.kick).toHaveBeenNthCalledWith(2, "new-slug", {
      forceRefresh: true,
    });
  });

  it.each([
    ["missing payload", undefined],
    ["missing intent", { platform: "kick", channelSlug: "test" }],
    ["unknown intent", { platform: "kick", channelSlug: "test", intent: "retry" }],
    ["blank slug", { platform: "kick", channelSlug: "   ", intent: "play" }],
    ["oversized slug", { platform: "kick", channelSlug: "x".repeat(129), intent: "play" }],
    [
      "unexpected field",
      { platform: "kick", channelSlug: "test", intent: "play", forceRefresh: true },
    ],
  ])("rejects %s before resolving playback", async (_label, payload) => {
    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
    const result = await handler({}, payload);

    expect(result).toEqual({ success: false, error: "Invalid Stream playback request" });
    expect(resolverMocks.kick).not.toHaveBeenCalled();
    expect(resolverMocks.twitch).not.toHaveBeenCalled();
  });

  it("returns error envelope on unsupported platform", async () => {
    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "youtube", channelSlug: "test", intent: "play" });

    expect(result.success).toBe(false);
  });
});
