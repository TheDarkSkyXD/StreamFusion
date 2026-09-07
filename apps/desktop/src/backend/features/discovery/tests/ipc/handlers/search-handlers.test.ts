import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@backend/features/discovery/composition/twitch-discovery", () => ({
  twitchDiscovery: {
    platform: "twitch" as const,
    searchChannels: vi.fn(),
    searchCategories: vi.fn(),
    searchDiscovery: vi.fn(),
    isAuthenticated: vi.fn(),
    getUsersByLogin: vi.fn(),
    getFollowerCounts: vi.fn(),
  },
}));

vi.mock("@backend/features/discovery/composition/kick-discovery", () => ({
  kickDiscovery: {
    platform: "kick" as const,
    searchChannels: vi.fn(),
    search: vi.fn(),
    searchDiscovery: vi.fn(),
    isAuthenticated: vi.fn(),
    getChannelsBySlugs: vi.fn(),
    getOfficialChannelAccountStatus: vi.fn(),
  },
}));

vi.mock("@backend/features/discovery/adapters/twitch/user-endpoints", () => ({
  getFollowerCounts: vi.fn(),
}));

vi.mock("@backend/features/discovery/adapters/kick/channel-endpoints", () => ({
  getChannelsBySlugs: vi.fn(),
}));

vi.mock("@backend/features/discovery/adapters/kick/user-endpoints", () => ({
  getUsersById: vi.fn(),
}));

vi.mock("@backend/features/authentication/data/authentication-repository", () => ({
  authenticationRepository: {
    getKickUser: vi.fn(),
    getTwitchUser: vi.fn(),
  },
}));

vi.mock("@backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { SearchResultCollection } from "@/features/discovery/domain/search/search-result-validation";
import { kickDiscovery } from "@backend/features/discovery/composition/kick-discovery";
import { twitchDiscovery } from "@backend/features/discovery/composition/twitch-discovery";
import { authenticationRepository } from "@backend/features/authentication/data/authentication-repository";
import { getChannelsBySlugs } from "@backend/features/discovery/adapters/kick/channel-endpoints";
import { getUsersById } from "@backend/features/discovery/adapters/kick/user-endpoints";
import { getFollowerCounts } from "@backend/features/discovery/adapters/twitch/user-endpoints";
import { registerSearchHandlers } from "@backend/features/discovery/routes/search-routes";
import type { UnifiedChannel } from "@shared/platform-types";
import { DiscoveryResult } from "@streamfusion/core/discovery";
import { ipcMain } from "electron";

type SearchAllResult = DiscoveryResult<SearchResultCollection>;
type SearchAllSuccess = Extract<SearchAllResult, { success: true }>;
type SearchChannelsResult = {
  success: boolean;
  data: UnifiedChannel[];
  cursor?: string;
  error?: string;
};
type SearchAllObservedResult = {
  success: boolean;
  data: SearchResultCollection;
  providers?: Record<string, string>;
  error?: string;
};
type SearchCancelResult = { success: true; cancelled: boolean };

function channel(id: string, platform: "twitch" | "kick", username: string): UnifiedChannel {
  return {
    id,
    platform,
    username,
    displayName: username,
    avatarUrl: "",
    isLive: true,
    isVerified: false,
    isPartner: false,
  };
}

function category(id: string, platform: "twitch" | "kick", name: string) {
  return { id, platform, name, boxArtUrl: "" };
}

function twitchUser(login: string) {
  return {
    id: `user-${login}`,
    login,
    displayName: login,
    profileImageUrl: "",
    createdAt: "2020-01-01T00:00:00.000Z",
    broadcasterType: "" as const,
  };
}

function legacyKickChannel(
  id: string,
  username: string,
  flags: { is_banned?: boolean; is_deleted?: boolean } = {}
): UnifiedChannel & { is_banned?: boolean; is_deleted?: boolean } {
  return { ...channel(id, "kick", username), displayName: username, ...flags };
}

function emptySearchCollection(): SearchResultCollection {
  return { channels: [], categories: [], streams: [], videos: [], clips: [] };
}

type Handler<T> = (event: unknown, params: unknown) => Promise<T>;

function getHandler(channel: typeof IPC_CHANNELS.SEARCH_CHANNELS): Handler<SearchChannelsResult>;
function getHandler(channel: typeof IPC_CHANNELS.SEARCH_ALL): Handler<SearchAllObservedResult>;
function getHandler(channel: typeof IPC_CHANNELS.SEARCH_CANCEL): Handler<SearchCancelResult>;
function getHandler<T>(channel: string): Handler<T> {
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return (event, params) => Promise.resolve(Reflect.apply(call[1], undefined, [event, params]));
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
  vi.mocked(authenticationRepository.getKickUser).mockReturnValue(null);
  vi.mocked(authenticationRepository.getTwitchUser).mockReturnValue(null);
  vi.mocked(twitchDiscovery.isAuthenticated).mockReturnValue(false);
  vi.mocked(kickDiscovery.isAuthenticated).mockReturnValue(false);
  vi.mocked(kickDiscovery.getOfficialChannelAccountStatus).mockResolvedValue("unavailable");
  vi.mocked(twitchDiscovery.getFollowerCounts).mockImplementation((userIds) =>
    getFollowerCounts(twitchDiscovery as never, userIds)
  );
  vi.mocked(kickDiscovery.getChannelsBySlugs).mockImplementation((slugs) =>
    getChannelsBySlugs(kickDiscovery as never, slugs)
  );
  vi.mocked(twitchDiscovery.searchDiscovery).mockImplementation(async (query, options = {}) => ({
    channels: options.channelSeeds
      ? [...options.channelSeeds]
      : (
          await twitchDiscovery.searchChannels(query, {
            first: options.limit,
            liveOnly: false,
          })
        ).data,
    categories:
      options.includeCategories === false
        ? []
        : (await twitchDiscovery.searchCategories(query, { first: options.limit })).data,
    streams: [],
  }));
  vi.mocked(kickDiscovery.searchDiscovery).mockImplementation(async (query, options = {}) => {
    if (options.includeCategories === false) {
      return {
        channels: options.channelSeeds
          ? [...options.channelSeeds]
          : (await kickDiscovery.searchChannels(query)).data,
        categories: [],
        streams: [],
      };
    }
    const result = await kickDiscovery.search(query, {
      ...(options.channelSeeds ? { channelSeeds: [...options.channelSeeds] } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return {
      channels: result.channels ?? [],
      categories: result.categories ?? [],
      streams: result.streams ?? [],
    };
  });
  registerSearchHandlers({
    contentReaders: { twitch: twitchPlayback, kick: kickPlayback },
    readers: { twitch: twitchDiscovery, kick: kickDiscovery },
  });
});
// Guards: search IPC keeps platform failures isolated and returns partial results instead of blocking the UI.
// Guards: full search starts Twitch and Kick work in parallel so the search results page waits for the slower platform, not both in sequence.
// Guards: broad hydration reuses completed quick-search results, including empty providers, instead of repeating platform channel discovery.
// Guards: cancelling a stale broad request aborts its remaining backend fan-out.
// Guards: the live-only constraint reaches Kick search, where its fallback policy can preserve stream-picker correctness.
// Guards: broad result collections never place channel-shaped records in the streams field.
describe("registerSearchHandlers", () => {
  it("registers both search channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.SEARCH_CHANNELS);
    expect(channels).toContain(IPC_CHANNELS.SEARCH_ALL);
    expect(channels).toContain(IPC_CHANNELS.SEARCH_CANCEL);
    expect(channels).toContain(IPC_CHANNELS.SEARCH_STREAMS);
    expect(channels).toContain(IPC_CHANNELS.SEARCH_VIDEOS);
    expect(channels).toContain(IPC_CHANNELS.SEARCH_CLIPS);
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
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [{ ...channel("1", "twitch", "streamer"), displayName: "Streamer", isLive: false }],
      cursor: "tc",
    });
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
      data: [{ ...channel("2", "kick", "kicker"), displayName: "Kicker", isLive: true }],
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "er" });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].username).toBe("kicker");
    expect(result.cursor).toBe("tc");
  });

  it("searches only Twitch when platform=twitch", async () => {
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [{ ...channel("1", "twitch", "test"), displayName: "Test", isLive: false }],
      cursor: undefined,
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "test", platform: "twitch" });

    expect(result.success).toBe(true);
    expect(kickDiscovery.searchChannels).not.toHaveBeenCalled();
  });

  it("searches only Kick when platform=kick", async () => {
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
      data: [{ ...channel("1", "kick", "test"), displayName: "Test", isLive: false }],
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "test", platform: "kick" });

    expect(result.success).toBe(true);
    expect(twitchDiscovery.searchChannels).not.toHaveBeenCalled();
  });

  it("continues Kick-only paginated requests with the Kick cursor", async () => {
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
      data: [{ ...channel("2", "kick", "test-next-kick"), displayName: "TestNextKick" }],
      cursor: "kick-page-3",
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler(
      {},
      { query: "test", platform: "kick", after: "kick-page-2", limit: 50 }
    );

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.cursor).toBe("kick-page-3");
    expect(kickDiscovery.searchChannels).toHaveBeenCalledWith("test", {
      limit: 50,
      cursor: "kick-page-2",
    });
  });

  it("forwards the live-only constraint to Kick search", async () => {
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({ data: [] });

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    await handler({}, { query: "creator", platform: "kick", liveOnly: true });

    expect(kickDiscovery.searchChannels).toHaveBeenCalledWith("creator", {
      limit: 50,
      cursor: undefined,
      liveOnly: true,
    });
  });

  it("skips Kick on combined paginated requests because the shared cursor belongs to Twitch", async () => {
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [],
      cursor: undefined,
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    await handler({}, { query: "test", after: "page2" });

    expect(kickDiscovery.searchChannels).not.toHaveBeenCalled();
  });

  it("filters out invalid channels (no id or username)", async () => {
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [
        { ...channel("1", "twitch", "test-valid"), displayName: "TestValid" },
        { ...channel("", "twitch", "no-id"), displayName: "NoId" },
        { ...channel("3", "twitch", ""), displayName: "NoUser" },
      ],
      cursor: undefined,
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "test", platform: "twitch" });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].username).toBe("test-valid");
  });

  it("filters out banned/deleted Kick channels", async () => {
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
      data: [
        legacyKickChannel("1", "test-good"),
        legacyKickChannel("2", "banned", { is_banned: true }),
        legacyKickChannel("3", "deleted", { is_deleted: true }),
      ],
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "test", platform: "kick" });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].username).toBe("test-good");
  });

  it("does not run Kick enrichment lookups for unauthenticated search suggestions", async () => {
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
      data: [{ ...channel("1", "kick", "good"), displayName: "Good", isLive: false }],
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "good", platform: "kick" });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(getChannelsBySlugs).not.toHaveBeenCalled();
    expect(getUsersById).not.toHaveBeenCalled();
  });

  it("preserves live Kick directory matches that already have avatars", async () => {
    vi.mocked(kickDiscovery.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
      data: [
        {
          ...channel("1", "twitch", "creatorlive"),
          id: "1",
          username: "odablock",
          displayName: "OdaBlock",
          avatarUrl: "https://example.com/oda.webp",
          isLive: true,
          platform: "kick",
          isVerified: false,
          isPartner: false,
        },
      ],
      cursor: "100",
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "O", platform: "kick", limit: 50 });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].username).toBe("odablock");
    expect(result.data[0].displayName).toBe("OdaBlock");
    expect(result.cursor).toBe("100");
    expect(getChannelsBySlugs).not.toHaveBeenCalled();
    expect(getUsersById).not.toHaveBeenCalled();
  });

  it("enriches a live Kick result whose display name is still the lowercase slug", async () => {
    vi.mocked(kickDiscovery.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
      data: [
        {
          ...channel("2", "kick", "creator"),
          id: "123",
          username: "nickwhite",
          displayName: "nickwhite",
          avatarUrl: "https://example.com/nickwhite.webp",
          followerCount: 10_000,
          isLive: true,
        },
      ],
    });
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
    ]);
    vi.mocked(getUsersById).mockResolvedValue([
      {
        user_id: 123,
        name: "NickWhite",
        profile_picture: "https://example.com/nickwhite.webp",
      },
    ]);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "nickwhite", platform: "kick" });

    expect(getChannelsBySlugs).toHaveBeenCalledWith(kickDiscovery, ["nickwhite"]);
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
    vi.mocked(kickDiscovery.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
      data: [
        {
          ...channel("1", "twitch", "iceposeidonlive"),
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
    });
    vi.mocked(getChannelsBySlugs).mockResolvedValue([]);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "ambiguous-missing-batch", platform: "kick" });

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
    vi.mocked(kickDiscovery.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
      data: [
        {
          ...channel("2", "kick", "iceposeidon"),
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
    });
    vi.mocked(getChannelsBySlugs).mockResolvedValue([]);
    vi.mocked(kickDiscovery.getOfficialChannelAccountStatus).mockResolvedValue("not_found");

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "deleted-creator", platform: "kick" });

    expect(result).toEqual({ success: true, data: [], cursor: undefined });
    expect(kickDiscovery.getOfficialChannelAccountStatus).toHaveBeenCalledWith("deleted-creator");
  });

  it("classifies a Kick batch lookup failure as unavailable", async () => {
    vi.mocked(kickDiscovery.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
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
    });
    vi.mocked(getChannelsBySlugs).mockRejectedValue(new Error("Kick API error: 503"));

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "provider-outage-channel", platform: "kick" });

    expect(result.data).toEqual([
      expect.objectContaining({
        id: "outage-1",
        accountStatus: "unavailable",
      }),
    ]);
  });

  it("preserves an explicit suspended state when secondary enrichment fails", async () => {
    vi.mocked(kickDiscovery.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
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
    });
    vi.mocked(getChannelsBySlugs).mockRejectedValue(new Error("timeout"));

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "suspended-during-outage", platform: "kick" });

    expect(result.data).toEqual([
      expect.objectContaining({
        id: "suspended-1",
        accountStatus: "suspended",
      }),
    ]);
  });

  it("ranks an exact small creator above a popular live prefix match", async () => {
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [
        {
          ...channel("1", "twitch", "creatorlive"),
          id: "1",
          username: "creatorlive",
          displayName: "Creator Live",
          followerCount: 1_000_000,
          isLive: true,
          platform: "twitch",
        },
      ],
      cursor: undefined,
    });
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
      data: [
        {
          ...channel("2", "kick", "creator"),
          id: "2",
          username: "creator",
          displayName: "Creator",
          followerCount: 0,
          isLive: false,
          platform: "kick",
        },
      ],
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "creator" });

    expect(result.data.map((channel: { username: string }) => channel.username)).toEqual([
      "creator",
      "creatorlive",
    ]);
  });

  it("ranks a compact exact identity first in channel autocomplete responses", async () => {
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [
        {
          ...channel("1", "twitch", "iceposeidonlive"),
          id: "1",
          username: "iceposeidonlive",
          displayName: "IcePoseidonLive",
          followerCount: 1_000_000,
          isLive: true,
          platform: "twitch",
        },
      ],
      cursor: undefined,
    });
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
      data: [
        {
          ...channel("2", "kick", "iceposeidon"),
          id: "2",
          username: "iceposeidon",
          displayName: "IcePoseidon",
          followerCount: 0,
          isLive: false,
          platform: "kick",
        },
      ],
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "ice poseidon" });

    expect(result.data.map((channel: { username: string }) => channel.username)).toEqual([
      "iceposeidon",
      "iceposeidonlive",
    ]);
  });

  it("sorts exact matches before starts-with matches", async () => {
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [
        { ...channel("1", "twitch", "testmore"), displayName: "TestMore", isLive: false },
        { ...channel("2", "twitch", "test"), displayName: "Test", isLive: false },
      ],
      cursor: undefined,
    });
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({ data: [] });

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "test" });

    expect(result.data[0].username).toBe("test");
  });

  it("excludes own account unless query exactly matches own username", async () => {
    vi.mocked(authenticationRepository.getTwitchUser).mockReturnValue(twitchUser("myaccount"));
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [
        { ...channel("1", "twitch", "myaccount"), displayName: "MyAccount", isLive: false },
        { ...channel("2", "twitch", "mystreamer"), displayName: "MyStreamer", isLive: false },
      ],
      cursor: undefined,
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "my", platform: "twitch" });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].username).toBe("mystreamer");
  });

  it("marks authenticated Twitch partner search results as verified", async () => {
    vi.mocked(twitchDiscovery.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [{ ...channel("1", "twitch", "partner"), displayName: "Partner", isLive: false }],
      cursor: undefined,
    });
    vi.mocked(twitchDiscovery.getUsersByLogin).mockResolvedValue([
      {
        id: "1",
        login: "partner",
        displayName: "Partner",
        profileImageUrl: "https://example.com/partner.png",
        broadcasterType: "partner",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(getFollowerCounts).mockResolvedValue(new Map([["1", 1234]]));

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "partner", platform: "twitch" });

    expect(result.success).toBe(true);
    expect(result.data[0].isPartner).toBe(true);
    expect(result.data[0].isVerified).toBe(true);
  });

  it("preserves missing Twitch follower data across cached enrichment", async () => {
    vi.mocked(twitchDiscovery.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [
        {
          ...channel("missing-followers-1", "twitch", "missingfollowerscreator"),
          id: "missing-followers-1",
          username: "missingfollowerscreator",
          displayName: "Missing Followers Creator",
          isLive: false,
        },
      ],
      cursor: undefined,
    });
    vi.mocked(twitchDiscovery.getUsersByLogin).mockResolvedValue([
      {
        id: "missing-followers-1",
        login: "missingfollowerscreator",
        displayName: "Missing Followers Creator",
        profileImageUrl: "https://example.com/missing-followers.png",
        broadcasterType: "",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(getFollowerCounts).mockResolvedValue(new Map());

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const first = await handler({}, { query: "missingfollowerscreator", platform: "twitch" });
    const cached = await handler({}, { query: "missingfollowerscreator", platform: "twitch" });

    expect(first.data[0].followerCount).toBeUndefined();
    expect(cached.data[0].followerCount).toBeUndefined();
    expect(twitchDiscovery.getUsersByLogin).toHaveBeenCalledTimes(1);
  });

  it("preserves Kick partner metadata during authenticated channel enrichment", async () => {
    vi.mocked(kickDiscovery.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
      data: [
        {
          ...channel("1", "kick", "partner"),
          id: "1",
          username: "partner",
          displayName: "Partner",
          isLive: false,
          isPartner: true,
        },
      ],
    });
    vi.mocked(getChannelsBySlugs).mockResolvedValue([
      {
        ...channel("1", "kick", "partner"),
        id: "1",
        username: "partner",
        displayName: "Partner",
        avatarUrl: "",
        isLive: false,
        isVerified: false,
        isPartner: false,
      },
    ]);
    vi.mocked(getUsersById).mockResolvedValue([
      { user_id: 1, name: "Partner", profile_picture: "" },
    ]);

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "partner", platform: "kick" });

    expect(result.success).toBe(true);
    expect(result.data[0].isPartner).toBe(true);
  });

  it("includes own account when query exactly matches", async () => {
    vi.mocked(authenticationRepository.getTwitchUser).mockReturnValue(twitchUser("myaccount"));
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [{ ...channel("1", "twitch", "myaccount"), displayName: "MyAccount", isLive: false }],
      cursor: undefined,
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "myaccount", platform: "twitch" });

    expect(result.data).toHaveLength(1);
  });

  it("returns empty data on platform failure instead of crashing", async () => {
    vi.mocked(twitchDiscovery.searchChannels).mockRejectedValue(new Error("fail"));
    vi.mocked(kickDiscovery.searchChannels).mockRejectedValue(new Error("fail"));

    const handler = getHandler(IPC_CHANNELS.SEARCH_CHANNELS);
    const result = await handler({}, { query: "test" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });
});

describe("SEARCH_ALL", () => {
  it("aborts remaining broad work when the renderer cancels a stale request", async () => {
    const pendingKick = deferred<Awaited<ReturnType<typeof kickDiscovery.search>>>();
    let requestSignal: AbortSignal | undefined;
    vi.mocked(kickDiscovery.search).mockImplementation(
      (_query, options: Parameters<typeof kickDiscovery.search>[1]) => {
        requestSignal = options?.signal;
        return pendingKick.promise;
      }
    );

    const searchHandler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const cancelHandler = getHandler(IPC_CHANNELS.SEARCH_CANCEL);
    const pending = searchHandler({}, { query: "old", platform: "kick", requestId: "search-old" });

    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    await cancelHandler({}, { requestId: "search-old" });

    expect(requestSignal?.aborted).toBe(true);
    pendingKick.resolve({ channels: [], categories: [], streams: [], videos: [], clips: [] });
    await pending;
  });

  it("reuses quick-search channel seeds without repeating platform channel discovery", async () => {
    const twitchSeed = channel("t-xqc", "twitch", "xqc");
    const kickSeed = channel("k-xqc", "kick", "xqc");
    vi.mocked(twitchDiscovery.searchCategories).mockResolvedValue({ data: [] });
    vi.mocked(kickDiscovery.search).mockResolvedValue({
      ...emptySearchCollection(),
      channels: [kickSeed],
      streams: [],
      categories: [],
      videos: [],
      clips: [],
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = (await handler(
      {},
      { query: "xqc", channelSeeds: [twitchSeed, kickSeed] }
    )) as SearchAllSuccess;

    expect(twitchDiscovery.searchChannels).not.toHaveBeenCalled();
    expect(kickDiscovery.search).toHaveBeenCalledWith(
      "xqc",
      expect.objectContaining({ channelSeeds: [kickSeed], signal: expect.any(AbortSignal) })
    );
    expect(result.data.channels).toEqual(expect.arrayContaining([twitchSeed, kickSeed]));
  });

  it("keeps a live Twitch channel seed in channels without synthesizing an invalid stream", async () => {
    const twitchSeed = channel("t-live-xqc", "twitch", "xqc");
    vi.mocked(twitchDiscovery.searchCategories).mockResolvedValue({ data: [] });

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = (await handler(
      {},
      { query: "xqc", platform: "twitch", channelSeeds: [twitchSeed] }
    )) as SearchAllSuccess;

    expect(result.data.channels).toEqual([twitchSeed]);
    expect(result.data.streams).toEqual([]);
  });

  it("does not repeat channel discovery when completed quick searches were empty", async () => {
    vi.mocked(twitchDiscovery.searchCategories).mockResolvedValue({ data: [] });
    vi.mocked(kickDiscovery.search).mockResolvedValue({
      ...emptySearchCollection(),
      channels: [],
      streams: [],
      categories: [],
      videos: [],
      clips: [],
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    await handler(
      {},
      { query: "missing", channelSeeds: [], channelSeedPlatforms: ["twitch", "kick"] }
    );

    expect(twitchDiscovery.searchChannels).not.toHaveBeenCalled();
    expect(kickDiscovery.search).toHaveBeenCalledWith(
      "missing",
      expect.objectContaining({ channelSeeds: [], signal: expect.any(AbortSignal) })
    );
  });

  it("reuses Kick channel seeds for one-letter channel-first hydration", async () => {
    const kickSeed = channel("k-x", "kick", "xqc");

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = (await handler(
      {},
      { query: "x", platform: "kick", channelSeeds: [kickSeed] }
    )) as SearchAllSuccess;

    expect(kickDiscovery.searchChannels).not.toHaveBeenCalled();
    expect(result.data.channels).toEqual([kickSeed]);
    expect(result.data.streams).toEqual([]);
  });

  it("returns structured results with channels, categories, streams, videos, clips", async () => {
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [{ ...channel("1", "twitch", "chan"), displayName: "Chan" }],
      cursor: undefined,
    });
    vi.mocked(twitchDiscovery.searchCategories).mockResolvedValue({
      data: [category("c1", "twitch", "Valorant")],
    });
    vi.mocked(kickDiscovery.search).mockResolvedValue({
      ...emptySearchCollection(),
      channels: [{ ...channel("2", "kick", "kchan"), displayName: "KChan" }],
      streams: [],
      categories: [category("c2", "kick", "Slots")],
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = await handler({}, { query: "chan" });

    expect(result.success).toBe(true);
    expect(result.data.channels.length).toBeGreaterThan(0);
    expect(result.data.categories.length).toBeGreaterThan(0);
    expect(Array.isArray(result.data.streams)).toBe(true);
    expect(Array.isArray(result.data.videos)).toBe(true);
    expect(Array.isArray(result.data.clips)).toBe(true);
    expect(twitchDiscovery.searchDiscovery).toHaveBeenCalledWith(
      "chan",
      expect.objectContaining({ limit: 10, includeCategories: true })
    );
    expect(kickDiscovery.searchDiscovery).toHaveBeenCalledWith(
      "chan",
      expect.objectContaining({
        limit: 10,
        includeCategories: true,
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("keeps an explicitly suspended Kick account visible in full-search channels", async () => {
    vi.mocked(kickDiscovery.search).mockResolvedValue({
      ...emptySearchCollection(),
      channels: [
        {
          ...channel("1", "twitch", "test-small"),
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
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = await handler({}, { query: "suspended-full", platform: "kick" });

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
    vi.mocked(kickDiscovery.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickDiscovery.search).mockResolvedValue({
      ...emptySearchCollection(),
      channels: [
        {
          ...channel("2", "twitch", "test-popular"),
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
    });
    vi.mocked(getChannelsBySlugs).mockResolvedValue([]);
    vi.mocked(kickDiscovery.getOfficialChannelAccountStatus).mockResolvedValue("unavailable");

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = await handler({}, { query: "uncertain-full", platform: "kick" });

    expect(result.data.channels).toEqual([
      expect.objectContaining({
        id: "uncertain-full-1",
        accountStatus: "unavailable",
      }),
    ]);
  });

  it("excludes an exact Kick full-search channel after authoritative not_found", async () => {
    vi.mocked(kickDiscovery.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickDiscovery.search).mockResolvedValue({
      ...emptySearchCollection(),
      channels: [
        {
          ...channel("1", "twitch", "iceposeidonlive"),
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
    });
    vi.mocked(getChannelsBySlugs).mockResolvedValue([]);
    vi.mocked(kickDiscovery.getOfficialChannelAccountStatus).mockResolvedValue("not_found");

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = await handler({}, { query: "deleted-full", platform: "kick" });

    expect(result.data.channels).toEqual([]);
  });

  it("does not misclassify a live Twitch channel as a stream", async () => {
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [{ ...channel("1", "twitch", "live"), displayName: "Live" }],
      cursor: undefined,
    });
    vi.mocked(twitchDiscovery.searchCategories).mockResolvedValue({ data: [] });
    vi.mocked(kickDiscovery.search).mockResolvedValue({
      ...emptySearchCollection(),
      channels: [],
      streams: [],
      categories: [],
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = await handler({}, { query: "live" });

    expect(result.data.channels).toHaveLength(1);
    expect(result.data.streams).toEqual([]);
  });

  it("searches only Twitch when platform=twitch", async () => {
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [],
      cursor: undefined,
    });
    vi.mocked(twitchDiscovery.searchCategories).mockResolvedValue({ data: [] });

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    await handler({}, { query: "test", platform: "twitch" });

    expect(kickDiscovery.search).not.toHaveBeenCalled();
  });

  it("searches only Kick when platform=kick", async () => {
    vi.mocked(kickDiscovery.search).mockResolvedValue({
      ...emptySearchCollection(),
      channels: [],
      streams: [],
      categories: [],
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    await handler({}, { query: "test", platform: "kick" });

    expect(twitchDiscovery.searchChannels).not.toHaveBeenCalled();
  });

  it("uses follower count only to break full-search relevance ties", async () => {
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [
        {
          ...channel("2", "twitch", "test-popular"),
          ...channel("2", "kick", "iceposeidon"),
          id: "1",
          platform: "twitch",
          username: "test-small",
          displayName: "Test Small",
          followerCount: 10,
          isLive: false,
        },
        {
          ...channel("2", "twitch", "test-popular"),
          id: "2",
          platform: "twitch",
          username: "test-popular",
          displayName: "Test Popular",
          followerCount: 10_000,
          isLive: false,
        },
      ],
      cursor: undefined,
    });
    vi.mocked(twitchDiscovery.searchCategories).mockResolvedValue({ data: [] });
    vi.mocked(kickDiscovery.search).mockResolvedValue({
      ...emptySearchCollection(),
      channels: [],
      streams: [],
      categories: [],
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = await handler({}, { query: "test" });

    expect(result.data.channels.map((channel: { id: string }) => channel.id)).toEqual(["2", "1"]);
  });

  it("ranks a compact exact identity first in full-search responses", async () => {
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [
        {
          ...channel("1", "twitch", "iceposeidonlive"),
          id: "1",
          platform: "twitch",
          username: "iceposeidonlive",
          displayName: "IcePoseidonLive",
          followerCount: 1_000_000,
          isLive: false,
        },
      ],
      cursor: undefined,
    });
    vi.mocked(twitchDiscovery.searchCategories).mockResolvedValue({ data: [] });
    vi.mocked(kickDiscovery.search).mockResolvedValue({
      ...emptySearchCollection(),
      channels: [
        {
          ...channel("2", "kick", "iceposeidon"),
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
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = await handler({}, { query: "ice poseidon" });

    expect(result.data.channels.map((channel: { username: string }) => channel.username)).toEqual([
      "iceposeidon",
      "iceposeidonlive",
    ]);
  });

  it("gracefully handles Twitch search failure in SEARCH_ALL (inner catch), returning empty results", async () => {
    vi.mocked(twitchDiscovery.searchChannels).mockRejectedValue(new Error("twitch down"));
    vi.mocked(twitchDiscovery.searchCategories).mockRejectedValue(new Error("twitch down"));

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = await handler({}, { query: "x", platform: "twitch" });

    expect(result.success).toBe(true);
    expect(result.data.channels).toEqual([]);
    expect(result.data.categories).toEqual([]);
  });

  it("continues when one platform search fails in combined mode", async () => {
    vi.mocked(twitchDiscovery.searchChannels).mockRejectedValue(new Error("twitch down"));
    vi.mocked(twitchDiscovery.searchCategories).mockRejectedValue(new Error("twitch down"));
    vi.mocked(kickDiscovery.search).mockResolvedValue({
      ...emptySearchCollection(),
      channels: [{ ...channel("k1", "kick", "test-kchan"), displayName: "TestKChan" }],
      streams: [],
      categories: [],
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = await handler({}, { query: "test" });

    expect(result.success).toBe(true);
    expect(result.data.channels.length).toBe(1);
    expect(result.providers).toEqual({ twitch: "failed", kick: "complete" });
  });

  it("starts Kick full search before Twitch full search resolves", async () => {
    const twitchChannels = deferred<Awaited<ReturnType<typeof twitchDiscovery.searchChannels>>>();
    const twitchCategories =
      deferred<Awaited<ReturnType<typeof twitchDiscovery.searchCategories>>>();
    vi.mocked(twitchDiscovery.searchChannels).mockReturnValue(twitchChannels.promise);
    vi.mocked(twitchDiscovery.searchCategories).mockReturnValue(twitchCategories.promise);
    vi.mocked(kickDiscovery.search).mockResolvedValue({
      ...emptySearchCollection(),
      channels: [{ ...channel("k1", "kick", "test-kchan"), displayName: "TestKChan" }],
      streams: [],
      categories: [],
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const pending = handler({}, { query: "test" });

    await vi.waitFor(() =>
      expect(kickDiscovery.search).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );

    twitchChannels.resolve({ data: [], cursor: undefined });
    twitchCategories.resolve({ data: [] });
    const result = (await pending) as SearchAllSuccess;

    expect(result.success).toBe(true);
    expect(result.data.channels).toHaveLength(1);
  });

  it("keeps one-letter full search channel-first instead of fanning out broad category searches", async () => {
    vi.mocked(twitchDiscovery.searchChannels).mockResolvedValue({
      data: [{ ...channel("t1", "twitch", "alpha"), displayName: "Alpha", isLive: false }],
      cursor: undefined,
    });
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
      data: [{ ...channel("k1", "kick", "ace"), displayName: "Ace" }],
    });

    const handler = getHandler(IPC_CHANNELS.SEARCH_ALL);
    const result = await handler({}, { query: "A", limit: 20 });

    expect(result.success).toBe(true);
    expect(result.data.channels).toHaveLength(2);
    expect(result.data.streams).toEqual([]);
    expect(result.data.categories).toEqual([]);
    expect(twitchDiscovery.searchCategories).not.toHaveBeenCalled();
    expect(kickDiscovery.search).not.toHaveBeenCalled();
    expect(kickDiscovery.searchChannels).toHaveBeenCalledWith("A");
  });
});
import { twitchPlayback } from "@backend/features/playback/composition/twitch-playback";
import { kickPlayback } from "@backend/features/playback/composition/kick-playback";
