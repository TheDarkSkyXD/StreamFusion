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
    getOfficialChannelAccountStatus: vi.fn(),
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
import { getChannelsBySlugs } from "@/backend/api/platforms/kick/endpoints/channel-endpoints";
import { getUsersById } from "@/backend/api/platforms/kick/endpoints/user-endpoints";
import { kickClient } from "@/backend/api/platforms/kick/kick-client";
import { getFollowerCounts } from "@/backend/api/platforms/twitch/endpoints/user-endpoints";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storageService.getKickUser).mockReturnValue(null);
  vi.mocked(storageService.getTwitchUser).mockReturnValue(null);
  vi.mocked(twitchClient.isAuthenticated).mockReturnValue(false);
  vi.mocked(kickClient.isAuthenticated).mockReturnValue(false);
  vi.mocked(kickClient.getOfficialChannelAccountStatus).mockResolvedValue("unavailable");
  registerSearchHandlers();
});

// Guards: search IPC keeps platform failures isolated and returns partial results instead of blocking the UI.
// Guards: full search starts Twitch and Kick work in parallel so the search results page waits for the slower platform, not both in sequence.
// Guards: the live-only constraint reaches Kick search, where its fallback policy can preserve stream-picker correctness.
describe("registerSearchHandlers", () => {
  it("registers both search channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.SEARCH_CHANNELS);
    expect(channels).toContain(IPC_CHANNELS.SEARCH_ALL);
  });
});

// Guards: authenticated Kick search enriches slug-like display names even when upstream already supplied an avatar or live metadata.
// Guards: authenticated Kick search keeps the fast path for results that already carry a cased profile display name.
// Guards: channel-search enrichment reuses getChannelsBySlugs user data rather than fetching the same Kick users twice.
// Guards: an authenticated Kick batch omission preserves the candidate as unavailable instead of inferring deletion.
// Guards: Kick lookup failures preserve searchable identity as unavailable instead of ordinary active/offline or deleted.
// Guards: an explicit suspended classification survives a secondary enrichment failure.
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
    const result = (await handler({}, { query: "er" })) as any;

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

  it("continues Kick-only paginated requests with the Kick cursor", async () => {
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [{ id: "2", username: "test-next-kick", displayName: "TestNextKick", isLive: true }],
      cursor: "kick-page-3",
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler(
      {},
      { query: "test", platform: "kick", after: "kick-page-2", limit: 50 }
    )) as any;

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.cursor).toBe("kick-page-3");
    expect(kickClient.searchChannels).toHaveBeenCalledWith("test", {
      limit: 50,
      cursor: "kick-page-2",
    });
  });

  it("forwards the live-only constraint to Kick search", async () => {
    vi.mocked(kickClient.searchChannels).mockResolvedValue({ data: [] } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    await handler({}, { query: "creator", platform: "kick", liveOnly: true });

    expect(kickClient.searchChannels).toHaveBeenCalledWith("creator", {
      limit: 50,
      cursor: undefined,
      liveOnly: true,
    });
  });

  it("skips Kick on combined paginated requests because the shared cursor belongs to Twitch", async () => {
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
        { id: "1", username: "test-valid", displayName: "TestValid", isLive: false },
        { id: "", username: "no-id", displayName: "NoId", isLive: false },
        { id: "3", username: "", displayName: "NoUser", isLive: false },
      ],
      cursor: undefined,
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "test", platform: "twitch" })) as any;

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].username).toBe("test-valid");
  });

  it("filters out banned/deleted Kick channels", async () => {
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [
        { id: "1", username: "test-good", displayName: "TestGood", isLive: false },
        { id: "2", username: "banned", displayName: "Banned", isLive: false, is_banned: true },
        { id: "3", username: "deleted", displayName: "Deleted", isLive: false, is_deleted: true },
      ],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "test", platform: "kick" })) as any;

    expect(result.data).toHaveLength(1);
    expect(result.data[0].username).toBe("test-good");
  });

  it("does not run Kick enrichment lookups for unauthenticated search suggestions", async () => {
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [{ id: "1", username: "good", displayName: "Good", isLive: false }],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "good", platform: "kick" })) as any;

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(getChannelsBySlugs).not.toHaveBeenCalled();
    expect(getUsersById).not.toHaveBeenCalled();
  });

  it("preserves live Kick directory matches that already have avatars", async () => {
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "1",
          username: "odablock",
          displayName: "OdaBlock",
          avatarUrl: "https://example.com/oda.webp",
          isLive: true,
        },
      ],
      cursor: "100",
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "O", platform: "kick", limit: 50 })) as any;

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].username).toBe("odablock");
    expect(result.data[0].displayName).toBe("OdaBlock");
    expect(result.cursor).toBe("100");
    expect(getChannelsBySlugs).not.toHaveBeenCalled();
    expect(getUsersById).not.toHaveBeenCalled();
  });

  it("enriches a live Kick result whose display name is still the lowercase slug", async () => {
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "123",
          username: "nickwhite",
          displayName: "nickwhite",
          avatarUrl: "https://example.com/nickwhite.webp",
          followerCount: 10_000,
          isLive: true,
        },
      ],
    } as any);
    vi.mocked(getChannelsBySlugs).mockResolvedValue([
      {
        id: "123",
        platform: "kick",
        username: "nickwhite",
        displayName: "NickWhite",
        avatarUrl: "https://example.com/nickwhite.webp",
        isLive: true,
        isVerified: false,
        isPartner: false,
      },
    ] as any);
    vi.mocked(getUsersById).mockResolvedValue([
      {
        user_id: 123,
        name: "NickWhite",
        profile_picture: "https://example.com/nickwhite.webp",
      },
    ] as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "nickwhite", platform: "kick" })) as any;

    expect(getChannelsBySlugs).toHaveBeenCalledWith(kickClient, ["nickwhite"]);
    expect(getUsersById).not.toHaveBeenCalled();
    expect(result.data[0]).toMatchObject({
      username: "nickwhite",
      displayName: "NickWhite",
      avatarUrl: "https://example.com/nickwhite.webp",
      isLive: true,
      followerCount: 10_000,
    });
  });

  it("preserves an ambiguously omitted Kick batch result as unavailable", async () => {
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "missing-batch-1",
          platform: "kick",
          username: "ambiguous-missing-batch",
          displayName: "Ambiguous Missing Batch",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
          accountStatus: "active",
        },
      ],
    } as any);
    vi.mocked(getChannelsBySlugs).mockResolvedValue([]);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler(
      {},
      { query: "ambiguous-missing-batch", platform: "kick" }
    )) as any;

    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          id: "missing-batch-1",
          username: "ambiguous-missing-batch",
          accountStatus: "unavailable",
        }),
      ],
      cursor: undefined,
    });
  });

  it("excludes an exact Kick result only after authoritative not_found", async () => {
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "deleted-1",
          platform: "kick",
          username: "deleted-creator",
          displayName: "DeletedCreator",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
          accountStatus: "active",
        },
      ],
    } as any);
    vi.mocked(getChannelsBySlugs).mockResolvedValue([]);
    vi.mocked(kickClient.getOfficialChannelAccountStatus).mockResolvedValue("not_found");

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "deleted-creator", platform: "kick" });

    expect(result).toEqual({ success: true, data: [], cursor: undefined });
    expect(kickClient.getOfficialChannelAccountStatus).toHaveBeenCalledWith("deleted-creator");
  });

  it("classifies a Kick batch lookup failure as unavailable", async () => {
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "outage-1",
          platform: "kick",
          username: "provider-outage-channel",
          displayName: "Provider Outage Channel",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
          accountStatus: "active",
        },
      ],
    } as any);
    vi.mocked(getChannelsBySlugs).mockRejectedValue(new Error("Kick API error: 503"));

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler(
      {},
      { query: "provider-outage-channel", platform: "kick" }
    )) as any;

    expect(result.data).toEqual([
      expect.objectContaining({
        id: "outage-1",
        accountStatus: "unavailable",
      }),
    ]);
  });

  it("preserves an explicit suspended state when secondary enrichment fails", async () => {
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "suspended-1",
          platform: "kick",
          username: "suspended-during-outage",
          displayName: "Suspended During Outage",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
          accountStatus: "suspended",
        },
      ],
    } as any);
    vi.mocked(getChannelsBySlugs).mockRejectedValue(new Error("timeout"));

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler(
      {},
      { query: "suspended-during-outage", platform: "kick" }
    )) as any;

    expect(result.data).toEqual([
      expect.objectContaining({
        id: "suspended-1",
        accountStatus: "suspended",
      }),
    ]);
  });

  it("ranks an exact small creator above a popular live prefix match", async () => {
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "1",
          username: "creatorlive",
          displayName: "Creator Live",
          followerCount: 1_000_000,
          isLive: true,
          platform: "twitch",
        },
      ],
      cursor: undefined,
    } as any);
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "2",
          username: "creator",
          displayName: "Creator",
          followerCount: 0,
          isLive: false,
          platform: "kick",
        },
      ],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "creator" })) as any;

    expect(result.data.map((channel: { username: string }) => channel.username)).toEqual([
      "creator",
      "creatorlive",
    ]);
  });

  it("ranks a compact exact identity first in channel autocomplete responses", async () => {
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "1",
          username: "iceposeidonlive",
          displayName: "IcePoseidonLive",
          followerCount: 1_000_000,
          isLive: true,
          platform: "twitch",
        },
      ],
      cursor: undefined,
    } as any);
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "2",
          username: "iceposeidon",
          displayName: "IcePoseidon",
          followerCount: 0,
          isLive: false,
          platform: "kick",
        },
      ],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "ice poseidon" })) as any;

    expect(result.data.map((channel: { username: string }) => channel.username)).toEqual([
      "iceposeidon",
      "iceposeidonlive",
    ]);
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
        { id: "2", username: "mystreamer", displayName: "MyStreamer", isLive: false },
      ],
      cursor: undefined,
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "my", platform: "twitch" })) as any;

    expect(result.data).toHaveLength(1);
    expect(result.data[0].username).toBe("mystreamer");
  });

  it("marks authenticated Twitch partner search results as verified", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [{ id: "1", username: "partner", displayName: "Partner", isLive: false }],
      cursor: undefined,
    } as any);
    vi.mocked(twitchClient.getUsersByLogin).mockResolvedValue([
      {
        id: "1",
        login: "partner",
        displayName: "Partner",
        profileImageUrl: "https://example.com/partner.png",
        broadcasterType: "partner",
      },
    ] as any);
    vi.mocked(getFollowerCounts).mockResolvedValue(new Map([["1", 1234]]));

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "partner", platform: "twitch" })) as any;

    expect(result.success).toBe(true);
    expect(result.data[0].isPartner).toBe(true);
    expect(result.data[0].isVerified).toBe(true);
  });

  it("preserves missing Twitch follower data across cached enrichment", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "missing-followers-1",
          username: "missingfollowerscreator",
          displayName: "Missing Followers Creator",
          isLive: false,
        },
      ],
      cursor: undefined,
    } as any);
    vi.mocked(twitchClient.getUsersByLogin).mockResolvedValue([
      {
        id: "missing-followers-1",
        login: "missingfollowerscreator",
        displayName: "Missing Followers Creator",
        profileImageUrl: "https://example.com/missing-followers.png",
        broadcasterType: "",
      },
    ] as any);
    vi.mocked(getFollowerCounts).mockResolvedValue(new Map());

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const first = (await handler(
      {},
      { query: "missingfollowerscreator", platform: "twitch" }
    )) as any;
    const cached = (await handler(
      {},
      { query: "missingfollowerscreator", platform: "twitch" }
    )) as any;

    expect(first.data[0].followerCount).toBeUndefined();
    expect(cached.data[0].followerCount).toBeUndefined();
    expect(twitchClient.getUsersByLogin).toHaveBeenCalledTimes(1);
  });

  it("preserves Kick partner metadata during authenticated channel enrichment", async () => {
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "1",
          username: "partner",
          displayName: "Partner",
          isLive: false,
          isPartner: true,
        },
      ],
    } as any);
    vi.mocked(getChannelsBySlugs).mockResolvedValue([
      {
        id: "1",
        username: "partner",
        displayName: "Partner",
        avatarUrl: "",
        isLive: false,
        isVerified: false,
        isPartner: false,
      },
    ] as any);
    vi.mocked(getUsersById).mockResolvedValue([{ user_id: 1, name: "Partner" }] as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = (await handler({}, { query: "partner", platform: "kick" })) as any;

    expect(result.success).toBe(true);
    expect(result.data[0].isPartner).toBe(true);
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
    const result = (await handler({}, { query: "chan" })) as any;

    expect(result.success).toBe(true);
    expect(result.data.channels.length).toBeGreaterThan(0);
    expect(result.data.categories.length).toBeGreaterThan(0);
    expect(Array.isArray(result.data.streams)).toBe(true);
    expect(Array.isArray(result.data.videos)).toBe(true);
    expect(Array.isArray(result.data.clips)).toBe(true);
  });

  it("keeps an explicitly suspended Kick account visible in full-search channels", async () => {
    vi.mocked(kickClient.search).mockResolvedValue({
      channels: [
        {
          id: "suspended-full-1",
          platform: "kick",
          username: "suspended-full",
          displayName: "SuspendedFull",
          avatarUrl: "https://example.com/suspended-full.webp",
          isLive: false,
          isVerified: false,
          isPartner: false,
          accountStatus: "suspended",
        },
      ],
      streams: [],
      categories: [],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = (await handler({}, { query: "suspended-full", platform: "kick" })) as any;

    expect(result.data.channels).toEqual([
      expect.objectContaining({
        id: "suspended-full-1",
        displayName: "SuspendedFull",
        avatarUrl: "https://example.com/suspended-full.webp",
        accountStatus: "suspended",
      }),
    ]);
  });

  it("keeps an uncertain exact Kick account visible as unavailable in full search", async () => {
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickClient.search).mockResolvedValue({
      channels: [
        {
          id: "uncertain-full-1",
          platform: "kick",
          username: "uncertain-full",
          displayName: "UncertainFull",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
          accountStatus: "active",
        },
      ],
      streams: [],
      categories: [],
    } as any);
    vi.mocked(getChannelsBySlugs).mockResolvedValue([]);
    vi.mocked(kickClient.getOfficialChannelAccountStatus).mockResolvedValue("unavailable");

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = (await handler({}, { query: "uncertain-full", platform: "kick" })) as any;

    expect(result.data.channels).toEqual([
      expect.objectContaining({
        id: "uncertain-full-1",
        accountStatus: "unavailable",
      }),
    ]);
  });

  it("excludes an exact Kick full-search channel after authoritative not_found", async () => {
    vi.mocked(kickClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickClient.search).mockResolvedValue({
      channels: [
        {
          id: "deleted-full-1",
          platform: "kick",
          username: "deleted-full",
          displayName: "DeletedFull",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
          accountStatus: "active",
        },
      ],
      streams: [],
      categories: [],
    } as any);
    vi.mocked(getChannelsBySlugs).mockResolvedValue([]);
    vi.mocked(kickClient.getOfficialChannelAccountStatus).mockResolvedValue("not_found");

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = (await handler({}, { query: "deleted-full", platform: "kick" })) as any;

    expect(result.data.channels).toEqual([]);
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

  it("uses follower count only to break full-search relevance ties", async () => {
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "1",
          platform: "twitch",
          username: "test-small",
          displayName: "Test Small",
          followerCount: 10,
          isLive: false,
        },
        {
          id: "2",
          platform: "twitch",
          username: "test-popular",
          displayName: "Test Popular",
          followerCount: 10_000,
          isLive: false,
        },
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

    expect(result.data.channels.map((channel: { id: string }) => channel.id)).toEqual(["2", "1"]);
  });

  it("ranks a compact exact identity first in full-search responses", async () => {
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "1",
          platform: "twitch",
          username: "iceposeidonlive",
          displayName: "IcePoseidonLive",
          followerCount: 1_000_000,
          isLive: false,
        },
      ],
      cursor: undefined,
    } as any);
    vi.mocked(twitchClient.searchCategories).mockResolvedValue({ data: [] } as any);
    vi.mocked(kickClient.search).mockResolvedValue({
      channels: [
        {
          id: "2",
          platform: "kick",
          username: "iceposeidon",
          displayName: "IcePoseidon",
          followerCount: 0,
          isLive: false,
        },
      ],
      streams: [],
      categories: [],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = (await handler({}, { query: "ice poseidon" })) as any;

    expect(result.data.channels.map((channel: { username: string }) => channel.username)).toEqual([
      "iceposeidon",
      "iceposeidonlive",
    ]);
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
      channels: [{ id: "k1", username: "test-kchan", displayName: "TestKChan" }],
      streams: [],
      categories: [],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = (await handler({}, { query: "test" })) as any;

    expect(result.success).toBe(true);
    expect(result.data.channels.length).toBe(1);
  });

  it("starts Kick full search before Twitch full search resolves", async () => {
    const twitchChannels = deferred<any>();
    const twitchCategories = deferred<any>();
    vi.mocked(twitchClient.searchChannels).mockReturnValue(twitchChannels.promise);
    vi.mocked(twitchClient.searchCategories).mockReturnValue(twitchCategories.promise);
    vi.mocked(kickClient.search).mockResolvedValue({
      channels: [{ id: "k1", username: "test-kchan", displayName: "TestKChan" }],
      streams: [],
      categories: [],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const pending = handler({}, { query: "test" });

    await vi.waitFor(() => expect(kickClient.search).toHaveBeenCalledWith("test"));

    twitchChannels.resolve({ data: [], cursor: undefined });
    twitchCategories.resolve({ data: [] });
    const result = (await pending) as any;

    expect(result.success).toBe(true);
    expect(result.data.channels).toHaveLength(1);
  });

  it("keeps one-letter full search channel-first instead of fanning out broad category searches", async () => {
    vi.mocked(twitchClient.searchChannels).mockResolvedValue({
      data: [{ id: "t1", username: "alpha", displayName: "Alpha", isLive: false }],
      cursor: undefined,
    } as any);
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [{ id: "k1", username: "ace", displayName: "Ace", isLive: true }],
    } as any);

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = (await handler({}, { query: "A", limit: 20 })) as any;

    expect(result.success).toBe(true);
    expect(result.data.channels).toHaveLength(2);
    expect(result.data.streams).toHaveLength(1);
    expect(result.data.categories).toEqual([]);
    expect(twitchClient.searchCategories).not.toHaveBeenCalled();
    expect(kickClient.search).not.toHaveBeenCalled();
    expect(kickClient.searchChannels).toHaveBeenCalledWith("A");
  });
});
