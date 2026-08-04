import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";
import { createIsolatedDatabaseTestLifecycle } from "../../../helpers/database-test-lifecycle";

vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/api/platforms/twitch/twitch-client", () => ({
  twitchClient: {
    getTopStreams: vi.fn(),
    getStreamByLogin: vi.fn(),
    isAuthenticated: vi.fn(),
    getFollowedStreams: vi.fn(),
    getStreamsByLogins: vi.fn(),
  },
}));

vi.mock("@/backend/api/platforms/kick/kick-client", () => ({
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

vi.mock("@/backend/api/platforms/twitch/twitch-stream-resolver", () => {
  const fn = vi.fn();
  return {
    TwitchStreamResolver: class {
      static __mock = fn;
      getStreamPlaybackUrl = fn;
    },
  };
});

vi.mock("@/backend/api/platforms/kick/kick-stream-resolver", () => {
  const fn = vi.fn();
  return {
    KickStreamResolver: class {
      static __mock = fn;
      getStreamPlaybackUrl = fn;
    },
  };
});

vi.mock("@/backend/api/unified/registry", () => ({
  clients: {
    for: vi.fn(),
    all: vi.fn(),
    register: vi.fn(),
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

import { app, ipcMain } from "electron";

import { kickClient } from "@/backend/api/platforms/kick/kick-client";
import { twitchClient } from "@/backend/api/platforms/twitch/twitch-client";
import { clients } from "@/backend/api/unified/registry";
import {
  KICK_STARTUP_FOLLOWED_STREAM_SCAN_GRACE_MS,
  registerStreamHandlers,
  shouldDeferKickStartupFollowedStreamScan,
} from "@/backend/ipc/handlers/stream-handlers";
import { dbService } from "@/backend/services/database-service";
import { storageService } from "@/backend/services/storage-service";

type Handler = (event: unknown, params?: unknown) => Promise<unknown>;

const databaseLifecycle = createIsolatedDatabaseTestLifecycle(
  dbService,
  (directory) => vi.mocked(app.getPath).mockReturnValue(directory),
  "streamfusion-stream-handlers-"
);

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  databaseLifecycle.initialize();
  vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([]);
  vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([]);
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

describe("STREAMS_GET_TOP", () => {
  it("returns single platform result when platform is specified", async () => {
    const reader = {
      platform: "twitch",
      getTopStreams: vi.fn().mockResolvedValue({
        data: [{ id: "1", viewerCount: 100 }],
        cursor: "c1",
      }),
    };
    vi.mocked(clients.for).mockReturnValue(reader as any);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_TOP);
    const result = (await handler({}, { platform: "twitch" })) as any;

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: "1", viewerCount: 100 }]);
    expect(result.cursor).toBe("c1");
  });

  it("merges and sorts by viewerCount when both platforms requested", async () => {
    const twitchReader = {
      platform: "twitch",
      getTopStreams: vi.fn().mockResolvedValue({
        data: [{ id: "t1", viewerCount: 50 }],
      }),
    };
    const kickReader = {
      platform: "kick",
      getTopStreams: vi.fn().mockResolvedValue({
        data: [{ id: "k1", viewerCount: 200 }],
      }),
    };
    vi.mocked(clients.all).mockReturnValue([twitchReader, kickReader] as any);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_TOP);
    const result = (await handler({}, {})) as any;

    expect(result.success).toBe(true);
    expect(result.data[0].id).toBe("k1");
    expect(result.data[1].id).toBe("t1");
  });

  it("returns partial results when one platform throws", async () => {
    const twitchReader = {
      platform: "twitch",
      getTopStreams: vi.fn().mockRejectedValue(new Error("twitch down")),
    };
    const kickReader = {
      platform: "kick",
      getTopStreams: vi.fn().mockResolvedValue({
        data: [{ id: "k1", viewerCount: 100 }],
      }),
    };
    vi.mocked(clients.all).mockReturnValue([twitchReader, kickReader] as any);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_TOP);
    const result = (await handler({}, {})) as any;

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("k1");
  });
});

describe("STREAMS_GET_BY_CATEGORY", () => {
  it("fetches from both platforms when no platform specified", async () => {
    vi.mocked(twitchClient.getTopStreams).mockResolvedValue({
      data: [{ id: "t1", viewerCount: 50 }],
      cursor: "tc",
    } as any);
    vi.mocked(kickClient.getStreamsByCategory).mockResolvedValue({
      data: [{ id: "k1", viewerCount: 200 }],
      cursor: "kc",
    } as any);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY);
    const result = (await handler({}, { categoryId: "123" })) as any;

    expect(result.success).toBe(true);
    expect(result.data[0].viewerCount).toBe(200);
    expect(result.data[1].viewerCount).toBe(50);
  });

  it("fetches only Twitch when platform=twitch", async () => {
    vi.mocked(twitchClient.getTopStreams).mockResolvedValue({
      data: [{ id: "t1", viewerCount: 50 }],
      cursor: "tc",
    } as any);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY);
    const result = (await handler({}, { categoryId: "123", platform: "twitch" })) as any;

    expect(result.success).toBe(true);
    expect(result.platform).toBe("twitch");
    expect(kickClient.getStreamsByCategory).not.toHaveBeenCalled();
  });

  it("fetches only Kick when platform=kick", async () => {
    vi.mocked(kickClient.getStreamsByCategory).mockResolvedValue({
      data: [{ id: "k1", viewerCount: 100 }],
    } as any);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY);
    const result = (await handler({}, { categoryId: "123", platform: "kick" })) as any;

    expect(result.success).toBe(true);
    expect(result.platform).toBe("kick");
    expect(twitchClient.getTopStreams).not.toHaveBeenCalled();
  });

  it("returns consistent shape when single-platform fetch fails", async () => {
    vi.mocked(twitchClient.getTopStreams).mockRejectedValue(new Error("fail"));

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY);
    const result = (await handler({}, { categoryId: "123", platform: "twitch" })) as any;

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.platform).toBe("twitch");
  });
});

describe("STREAMS_GET_BY_CHANNEL", () => {
  it("fetches Twitch stream by login", async () => {
    const stream = { id: "s1", channel: "test" };
    vi.mocked(twitchClient.getStreamByLogin).mockResolvedValue(stream as any);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CHANNEL);
    const result = (await handler({}, { platform: "twitch", username: "test" })) as any;

    expect(result).toEqual({ success: true, data: stream });
  });

  it("fetches Kick stream by slug", async () => {
    const stream = { id: "s2", channel: "kickuser" };
    vi.mocked(kickClient.getStreamBySlug).mockResolvedValue(stream as any);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CHANNEL);
    const result = (await handler({}, { platform: "kick", username: "kickuser" })) as any;

    expect(result).toEqual({ success: true, data: stream });
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(twitchClient.getStreamByLogin).mockRejectedValue(new Error("offline"));

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_BY_CHANNEL);
    const result = (await handler({}, { platform: "twitch", username: "x" })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toBe("offline");
  });
});

describe("STREAMS_GET_FOLLOWED", () => {
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
      platform === "kick"
        ? ([
            { channelName: "kick-one" },
            { channelName: "kick-two" },
            { channelName: "kick-three" },
          ] as any)
        : []
    );
    vi.mocked(kickClient.getPublicStreamBySlug).mockResolvedValue(null);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = (await handler({}, { platform: "kick", limit: 2 })) as any;

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
        ? ([
            {
              id: "follow-1",
              platform: "kick",
              channelId: "123",
              channelName: "old-slug",
              displayName: "Old Slug",
              profileImage: "",
              followedAt: "2026-01-01T00:00:00.000Z",
            },
          ] as any)
        : []
    );
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([
      {
        id: "123",
        platform: "kick",
        username: "new-slug",
        displayName: "New Slug",
        avatarUrl: "https://example.com/new.jpg",
      },
    ] as any);
    vi.mocked(kickClient.getPublicChannel).mockResolvedValue({
      id: "123",
      platform: "kick",
      username: "new-slug",
      displayName: "New Slug",
      avatarUrl: "https://example.com/new.jpg",
      kickUserId: "123",
      isVerified: false,
    } as any);
    vi.mocked(kickClient.getStreamsByBroadcasterIds).mockResolvedValue([
      {
        id: "stream-123",
        channelId: "123",
        channelName: "new-slug",
        platform: "kick",
        viewerCount: 42,
      },
    ] as any);
    vi.mocked(kickClient.getPublicStreamBySlug).mockResolvedValue({
      id: "legacy-stream-123",
      viewerCount: 42,
    } as any);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = (await handler({}, { platform: "kick" })) as any;

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

  it("does not let a concurrent Kick followed-stream scan abort an already visible scan", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation((platform) =>
      platform === "kick" ? ([{ channelName: "kick-one" }, { channelName: "kick-two" }] as any) : []
    );

    const pending: Array<{
      slug: string;
      signal: AbortSignal;
      resolve: (stream: unknown) => void;
    }> = [];
    vi.mocked(kickClient.getPublicStreamBySlug).mockImplementation((slug, _stagger, signal) => {
      return new Promise((resolve, reject) => {
        const abortSignal = signal as AbortSignal;
        abortSignal.addEventListener("abort", () => reject(new Error("AbortError")), {
          once: true,
        });
        pending.push({ slug, signal: abortSignal, resolve });
      }) as any;
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const first = handler({}, { platform: "kick" });
    await vi.waitFor(() => expect(pending).toHaveLength(2));

    const second = handler({}, { platform: "kick" });
    await vi.waitFor(() => expect(pending).toHaveLength(4));

    expect(pending[0].signal.aborted).toBe(false);
    expect(pending[1].signal.aborted).toBe(false);

    for (const item of pending) {
      item.resolve({ id: `${item.slug}-stream`, viewerCount: item.slug === "kick-one" ? 20 : 10 });
    }

    const [firstResult, secondResult] = (await Promise.all([first, second])) as any[];

    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(true);
    expect(firstResult.data.map((stream: any) => stream.id).sort()).toEqual([
      "kick-one-stream",
      "kick-two-stream",
    ]);
    expect(secondResult.data.map((stream: any) => stream.id).sort()).toEqual([
      "kick-one-stream",
      "kick-two-stream",
    ]);
  });

  it("merges and sorts by viewerCount when both platforms requested", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchClient.getFollowedStreams).mockResolvedValue({
      data: [{ id: "t1", viewerCount: 50 }],
      cursor: "tc",
    } as any);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([]);

    vi.mocked(kickClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickClient.getFollowedStreams).mockResolvedValue({
      data: [{ id: "k1", viewerCount: 200 }],
    } as any);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = (await handler({}, {})) as any;

    expect(result.success).toBe(true);
    expect(result.data[0].viewerCount).toBe(200);
    expect(result.data[1].viewerCount).toBe(50);
  });

  it("returns empty array with success:true on outer catch", async () => {
    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation(() => {
      throw new Error("db corrupt");
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = (await handler({}, { platform: "twitch" })) as any;

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("deduplicates streams by id between remote and local", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchClient.getFollowedStreams).mockResolvedValue({
      data: [{ id: "overlap", viewerCount: 100 }],
    } as any);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      { channelName: "overlapuser" },
    ] as any);
    vi.mocked(twitchClient.getStreamsByLogins).mockResolvedValue({
      data: [{ id: "overlap", viewerCount: 100 }],
    } as any);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = (await handler({}, { platform: "twitch" })) as any;

    expect(result.success).toBe(true);
    const ids = result.data.map((s: any) => s.id);
    const uniqueIds = [...new Set(ids)];
    expect(ids.length).toBe(uniqueIds.length);
  });

  it("deduplicates Kick remote and public live results by broadcaster slug", async () => {
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickClient.getFollowedStreams).mockResolvedValue({
      data: [
        {
          id: "remote-live-id",
          platform: "kick",
          channelId: "kick-user-id",
          channelName: "xqc",
          viewerCount: 6300,
        },
      ],
    } as any);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation((platform) =>
      platform === "kick" ? ([{ channelId: "12345", channelName: "xqc" }] as any) : []
    );
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([]);
    vi.mocked(kickClient.getStreamsByBroadcasterIds).mockResolvedValue([
      {
        id: "public-live-id",
        platform: "kick",
        channelId: "kick-channel-id",
        channelName: "XQC",
        viewerCount: 6300,
      },
    ] as any);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = (await handler({}, { platform: "kick" })) as any;

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });
});

describe("STREAMS_GET_PLAYBACK_URL", () => {
  it("resolves Twitch playback URL", async () => {
    const { TwitchStreamResolver } = await import(
      "@/backend/api/platforms/twitch/twitch-stream-resolver"
    );
    (TwitchStreamResolver as any).__mock.mockResolvedValue({
      url: "https://twitch.tv/stream.m3u8",
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
    const result = (await handler({}, { platform: "twitch", channelSlug: "test" })) as any;

    expect(result.success).toBe(true);
    expect(result.data.url).toBe("https://twitch.tv/stream.m3u8");
  });

  it("resolves Kick playback URL", async () => {
    const { KickStreamResolver } = await import(
      "@/backend/api/platforms/kick/kick-stream-resolver"
    );
    (KickStreamResolver as any).__mock.mockResolvedValue({
      url: "https://kick.com/stream.m3u8",
    });

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
    const result = (await handler({}, { platform: "kick", channelSlug: "test" })) as any;

    expect(result.success).toBe(true);
    expect(result.data.url).toBe("https://kick.com/stream.m3u8");
  });

  it("repairs a renamed Kick follow slug and retries playback once", async () => {
    const { KickStreamResolver } = await import(
      "@/backend/api/platforms/kick/kick-stream-resolver"
    );
    (KickStreamResolver as any).__mock
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
      },
    ] as any);
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([
      {
        id: "123",
        platform: "kick",
        username: "new-slug",
        displayName: "New Slug",
        avatarUrl: "",
      },
    ] as any);

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
    const result = (await handler({}, { platform: "kick", channelSlug: "old-slug" })) as any;

    expect(result.success).toBe(true);
    expect(result.data.url).toBe("https://kick.com/repaired.m3u8");
    expect((KickStreamResolver as any).__mock).toHaveBeenNthCalledWith(1, "old-slug");
    expect((KickStreamResolver as any).__mock).toHaveBeenNthCalledWith(2, "new-slug");
    expect(storageService.updateLocalFollow).toHaveBeenCalledWith("follow-1", {
      channelName: "new-slug",
      displayName: "New Slug",
    });
  });

  it("returns error envelope on unsupported platform", async () => {
    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL);
    const result = (await handler(
      {},
      {
        platform: "youtube" as any,
        channelSlug: "test",
      }
    )) as any;

    expect(result.success).toBe(false);
  });
});
