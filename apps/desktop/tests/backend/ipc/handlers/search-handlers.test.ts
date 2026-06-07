import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/api/platforms/twitch/twitch-client", () => ({
  twitchClient: {
    searchChannels: vi.fn(),
    searchCategories: vi.fn(),
    isAuthenticated: vi.fn(),
    getUsersByLogin: vi.fn(),
  },
}));

vi.mock("@/backend/api/platforms/kick/kick-client", () => ({
  kickClient: {
    searchChannels: vi.fn(),
    search: vi.fn(),
    isAuthenticated: vi.fn(),
  },
}));

vi.mock("@/backend/api/platforms/twitch/endpoints/user-endpoints", () => ({
  getFollowerCounts: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/channel-endpoints", () => ({
  getChannelsBySlugs: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/user-endpoints", () => ({
  getUsersById: vi.fn(),
}));

vi.mock("@/backend/services/storage-service", () => ({
  storageService: {
    getKickUser: vi.fn(),
    getTwitchUser: vi.fn(),
  },
}));

vi.mock("@/backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ipcMain } from "electron";

import { kickClient } from "@/backend/api/platforms/kick/kick-client";
import { twitchClient } from "@/backend/api/platforms/twitch/twitch-client";
import { registerSearchHandlers } from "@/backend/ipc/handlers/search-handlers";
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
  vi.mocked(storageService.getKickUser).mockReturnValue(null);
  vi.mocked(storageService.getTwitchUser).mockReturnValue(null);
  vi.mocked(twitchClient.isAuthenticated).mockReturnValue(false);
  vi.mocked(kickClient.isAuthenticated).mockReturnValue(false);
  registerSearchHandlers();
});

describe("registerSearchHandlers", () => {
  it("registers both search channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.SEARCH_CHANNELS);
    expect(channels).toContain(IPC_CHANNELS.SEARCH_ALL);
  });
});

describe("SEARCH_CHANNELS", () => {
  it("searches both platforms when no platform specified", async () => {
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [{ id: "1", username: "streamer", displayName: "Streamer", isLive: false }],
      cursor: "tc",
    } as any);
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [{ id: "2", username: "kicker", displayName: "Kicker", isLive: true }],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "test" })) as any;

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].username).toBe("kicker");
    expect(result.cursor).toBe("tc");
  });

  it("searches only Twitch when platform=twitch", async () => {
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [{ id: "1", username: "test", displayName: "Test", isLive: false }],
      cursor: undefined,
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "test", platform: "twitch" })) as any;

    expect(result.success).toBe(true);
    expect(kickClient.searchChannels).not.toHaveBeenCalled();
  });

  it("searches only Kick when platform=kick", async () => {
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [{ id: "1", username: "test", displayName: "Test", isLive: false }],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "test", platform: "kick" })) as any;

    expect(result.success).toBe(true);
    expect(twitchClient.searchChannels).not.toHaveBeenCalled();
  });

  it("skips Kick on paginated requests (Kick has no cursor pagination)", async () => {
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [],
      cursor: undefined,
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    await handler({}, { query: "test", after: "page2" });

    expect(kickClient.searchChannels).not.toHaveBeenCalled();
  });

  it("filters out invalid channels (no id or username)", async () => {
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [
        { id: "1", username: "valid", displayName: "Valid", isLive: false },
        { id: "", username: "no-id", displayName: "NoId", isLive: false },
        { id: "3", username: "", displayName: "NoUser", isLive: false },
      ],
      cursor: undefined,
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "test", platform: "twitch" })) as any;

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].username).toBe("valid");
  });

  it("filters out banned/deleted Kick channels", async () => {
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [
        { id: "1", username: "good", displayName: "Good", isLive: false },
        { id: "2", username: "banned", displayName: "Banned", isLive: false, is_banned: true },
        { id: "3", username: "deleted", displayName: "Deleted", isLive: false, is_deleted: true },
      ],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "test", platform: "kick" })) as any;

    expect(result.data).toHaveLength(1);
    expect(result.data[0].username).toBe("good");
  });

  it("sorts live channels first in combined results", async () => {
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [{ id: "1", username: "offline", displayName: "Offline", isLive: false }],
      cursor: undefined,
    } as any);
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [{ id: "2", username: "live", displayName: "Live", isLive: true }],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "test" })) as any;

    expect(result.data[0].username).toBe("live");
    expect(result.data[1].username).toBe("offline");
  });

  it("sorts exact matches before starts-with matches", async () => {
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [
        { id: "1", username: "testmore", displayName: "TestMore", isLive: false },
        { id: "2", username: "test", displayName: "Test", isLive: false },
      ],
      cursor: undefined,
    } as any);
    vi.mocked(kickClient.searchChannels).mockResolvedValue({ data: [] } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "test" })) as any;

    expect(result.data[0].username).toBe("test");
  });

  it("excludes own account unless query exactly matches own username", async () => {
    vi.mocked(storageService.getTwitchUser).mockReturnValue({ login: "myaccount" } as any);
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [
        { id: "1", username: "myaccount", displayName: "MyAccount", isLive: false },
        { id: "2", username: "other", displayName: "Other", isLive: false },
      ],
      cursor: undefined,
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "my", platform: "twitch" })) as any;

    expect(result.data).toHaveLength(1);
    expect(result.data[0].username).toBe("other");
  });

  it("includes own account when query exactly matches", async () => {
    vi.mocked(storageService.getTwitchUser).mockReturnValue({ login: "myaccount" } as any);
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [{ id: "1", username: "myaccount", displayName: "MyAccount", isLive: false }],
      cursor: undefined,
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "myaccount", platform: "twitch" })) as any;

    expect(result.data).toHaveLength(1);
  });

  it("returns empty data on platform failure instead of crashing", async () => {
    vi.mocked(twitchClient.searchChannels).mockRejectedValue(new Error("fail"));
    vi.mocked(kickClient.searchChannels).mockRejectedValue(new Error("fail"));

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "test" })) as any;

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });
});

describe("SEARCH_ALL", () => {
  it("returns structured results with channels, categories, streams, videos, clips", async () => {
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [{ id: "1", username: "chan", displayName: "Chan", isLive: true }],
      cursor: undefined,
    } as any);
    vi.mocked(twitchClient.searchCategories).mockResolvedValue({
      data: [{ id: "c1", name: "Valorant" }],
    } as any);
    vi.mocked(kickClient.search).mockResolvedValue({
      channels: [{ id: "2", username: "kchan", displayName: "KChan" }],
      streams: [],
      categories: [{ id: "c2", name: "Slots" }],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = (await handler({}, { query: "test" })) as any;

    expect(result.success).toBe(true);
    expect(result.data.channels.length).toBeGreaterThan(0);
    expect(result.data.categories.length).toBeGreaterThan(0);
    expect(Array.isArray(result.data.streams)).toBe(true);
    expect(Array.isArray(result.data.videos)).toBe(true);
    expect(Array.isArray(result.data.clips)).toBe(true);
  });

  it("adds live Twitch channels to streams array", async () => {
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [{ id: "1", username: "live", displayName: "Live", isLive: true }],
      cursor: undefined,
    } as any);
    vi.mocked(twitchClient.searchCategories).mockResolvedValue({ data: [] } as any);
    vi.mocked(kickClient.search).mockResolvedValue({
      channels: [],
      streams: [],
      categories: [],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = (await handler({}, { query: "live" })) as any;

    expect(result.data.streams).toHaveLength(1);
    expect(result.data.streams[0].platform).toBe("twitch");
  });

  it("searches only Twitch when platform=twitch", async () => {
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [],
      cursor: undefined,
    } as any);
    vi.mocked(twitchClient.searchCategories).mockResolvedValue({ data: [] } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    await handler({}, { query: "test", platform: "twitch" });

    expect(kickClient.search).not.toHaveBeenCalled();
  });

  it("searches only Kick when platform=kick", async () => {
    vi.mocked(kickClient.search).mockResolvedValue({
      channels: [],
      streams: [],
      categories: [],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    await handler({}, { query: "test", platform: "kick" });

    expect(twitchClient.searchChannels).not.toHaveBeenCalled();
  });

  it("sorts channels by relevance (exact, starts-with, other)", async () => {
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [
        { id: "1", username: "testmore", displayName: "TestMore", isLive: false },
        { id: "2", username: "test", displayName: "Test", isLive: false },
      ],
      cursor: undefined,
    } as any);
    vi.mocked(twitchClient.searchCategories).mockResolvedValue({ data: [] } as any);
    vi.mocked(kickClient.search).mockResolvedValue({
      channels: [],
      streams: [],
      categories: [],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = (await handler({}, { query: "test" })) as any;

    expect(result.data.channels[0].username).toBe("test");
  });

  it("gracefully handles Twitch search failure in SEARCH_ALL (inner catch), returning empty results", async () => {
    vi.mocked(twitchClient.searchChannels).mockRejectedValue(new Error("twitch down"));
    vi.mocked(twitchClient.searchCategories).mockRejectedValue(new Error("twitch down"));

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = (await handler({}, { query: "x", platform: "twitch" })) as any;

    expect(result.success).toBe(true);
    expect(result.data.channels).toEqual([]);
    expect(result.data.categories).toEqual([]);
  });

  it("continues when one platform search fails in combined mode", async () => {
    vi.mocked(twitchClient.searchChannels).mockRejectedValue(new Error("twitch down"));
    vi.mocked(twitchClient.searchCategories).mockRejectedValue(new Error("twitch down"));
    vi.mocked(kickClient.search).mockResolvedValue({
      channels: [{ id: "k1", username: "kchan", displayName: "KChan" }],
      streams: [],
      categories: [],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = (await handler({}, { query: "test" })) as any;

    expect(result.success).toBe(true);
    expect(result.data.channels.length).toBe(1);
  });
});
