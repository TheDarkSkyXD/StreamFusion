import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

vi.mock("electron", () => ({
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
  },
}));

vi.mock("@/backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ipcMain } from "electron";

import { kickClient } from "@/backend/api/platforms/kick/kick-client";
import { twitchClient } from "@/backend/api/platforms/twitch/twitch-client";
import { clients } from "@/backend/api/unified/registry";
import {
  KICK_STARTUP_FOLLOWED_STREAM_SCAN_GRACE_MS,
  registerStreamHandlers,
  shouldDeferKickStartupFollowedStreamScan,
} from "@/backend/ipc/handlers/stream-handlers";
import { storageService } from "@/backend/services/storage-service";

type Handler = (event: unknown, params?: unknown) => Promise<unknown>;

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  registerStreamHandlers();
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
  it("detects only startup Kick followed-stream scans as deferrable", () => {
    expect(shouldDeferKickStartupFollowedStreamScan(undefined, 1000, 0)).toBe(true);
    expect(shouldDeferKickStartupFollowedStreamScan("kick", 1000, 0)).toBe(true);
    expect(shouldDeferKickStartupFollowedStreamScan("twitch", 1000, 0)).toBe(false);
    expect(
      shouldDeferKickStartupFollowedStreamScan(
        "kick",
        KICK_STARTUP_FOLLOWED_STREAM_SCAN_GRACE_MS + 1,
        0
      )
    ).toBe(false);
  });

  it("defers local Kick followed-stream fan-out during startup", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation((platform) =>
      platform === "kick" ? ([{ channelName: "kick-one" }, { channelName: "kick-two" }] as any) : []
    );

    const handler = getHandler(IPC_CHANNELS.STREAMS_GET_FOLLOWED);
    const result = (await handler({}, {})) as any;

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(kickClient.getPublicStreamBySlug).not.toHaveBeenCalled();
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
