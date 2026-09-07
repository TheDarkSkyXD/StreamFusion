import { twitchTransport } from "@backend/api/platforms/twitch/twitch-transport";
import { twitchPlayback } from "@backend/features/playback/composition/twitch-playback";
import { twitchAccountReader } from "@backend/features/authentication/composition/twitch-account-reader";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@backend/logging/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@shared/utils/sleep", () => ({
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock("@backend/features/authentication/adapters/twitch/twitch-auth", () => ({
  twitchAuthService: {
    getValidAccessToken: vi.fn(async () => "test-token"),
    isAuthenticated: vi.fn(() => true),
    refreshToken: vi.fn(async () => true),
    getAccessToken: vi.fn(() => "test-token"),
  },
}));

vi.mock("@backend/features/authentication/adapters/oauth/oauth-config", () => ({
  WORKER_BASE_URL: "https://worker.test",
  getOAuthConfig: () => ({ clientId: "test-client-id" }),
}));

vi.mock("electron", () => ({
  net: {
    fetch: vi.fn(async () => ({
      status: 200,
      headers: { forEach: () => {} },
      text: async () => JSON.stringify({ data: [] }),
    })),
  },
}));

const mockGqlGetStreamsByLogins = vi.fn();
const mockGqlGetTopStreams = vi.fn();
const mockGqlGetStreamByLogin = vi.fn();
const mockGqlGetChannelByLogin = vi.fn();
const mockGqlSearchChannels = vi.fn();
const mockGqlGetTopCategories = vi.fn();
const mockGqlGetAllTopCategories = vi.fn();
const mockGqlSearchCategories = vi.fn();
const mockGqlGetCategoryById = vi.fn();
const mockGqlGetCategoryViewerCountsByIds = vi.fn(async (..._args: unknown[]) => ({}));
const mockGqlGetVideosByChannel = vi.fn();
const mockGqlGetVideoMetadata = vi.fn();
const mockGqlFetchGamesForVideos = vi.fn();
const mockGqlGetClipsByChannel = vi.fn();
const mockGqlIsChannelLive = vi.fn();
const mockGqlGetFollowerCount = vi.fn();

vi.mock("@backend/features/discovery/adapters/twitch/twitch-gql-discovery", () => ({
  gqlGetStreamsByLogins: (...args: unknown[]) => mockGqlGetStreamsByLogins(...args),
  gqlGetTopStreams: (...args: unknown[]) => mockGqlGetTopStreams(...args),
  gqlGetStreamByLogin: (...args: unknown[]) => mockGqlGetStreamByLogin(...args),
  gqlGetChannelByLogin: (...args: unknown[]) => mockGqlGetChannelByLogin(...args),
  gqlSearchChannels: (...args: unknown[]) => mockGqlSearchChannels(...args),
  gqlGetTopCategories: (...args: unknown[]) => mockGqlGetTopCategories(...args),
  gqlGetAllTopCategories: (...args: unknown[]) => mockGqlGetAllTopCategories(...args),
  gqlSearchCategories: (...args: unknown[]) => mockGqlSearchCategories(...args),
  gqlGetCategoryById: (...args: unknown[]) => mockGqlGetCategoryById(...args),
  gqlGetCategoryViewerCountsByIds: (...args: unknown[]) =>
    mockGqlGetCategoryViewerCountsByIds(...args),
  gqlIsChannelLive: (...args: unknown[]) => mockGqlIsChannelLive(...args),
  gqlGetFollowerCount: (...args: unknown[]) => mockGqlGetFollowerCount(...args),
}));
const { mockGqlGetCategoryVideos, mockGqlGetCategoryClips } = vi.hoisted(() => ({
  mockGqlGetCategoryVideos: vi.fn(),
  mockGqlGetCategoryClips: vi.fn(),
}));
vi.mock("@backend/features/playback/adapters/twitch/twitch-gql-category-media", () => ({
  gqlGetCategoryVideos: mockGqlGetCategoryVideos,
  gqlGetCategoryClips: mockGqlGetCategoryClips,
}));

vi.mock("@backend/features/playback/adapters/twitch/twitch-gql-playback", () => ({
  gqlGetVideosByChannel: (...args: unknown[]) => mockGqlGetVideosByChannel(...args),
  gqlGetVideoMetadata: (...args: unknown[]) => mockGqlGetVideoMetadata(...args),
  gqlFetchGamesForVideos: (...args: unknown[]) => mockGqlFetchGamesForVideos(...args),
  gqlGetClipsByChannel: (...args: unknown[]) => mockGqlGetClipsByChannel(...args),
}));

vi.mock("@backend/features/discovery/adapters/twitch/stream-endpoints", () => ({
  getFollowedStreams: vi.fn(async () => ({ data: [] })),
  getTopStreams: vi.fn(async () => ({ data: [] })),
  getStreamByLogin: vi.fn(async () => null),
}));

vi.mock("@backend/features/authentication/adapters/twitch/account-endpoints", () => ({
  getUser: vi.fn(async () => null),
  getFollowedChannels: vi.fn(async () => ({ data: [] })),
  getAllFollowedChannels: vi.fn(async () => []),
}));
vi.mock("@backend/features/discovery/adapters/twitch/user-endpoints", () => ({
  getUser: vi.fn(async () => null),
  getUsersById: vi.fn(async () => []),
  getUsersByLogin: vi.fn(async () => []),
  getFollowerCounts: vi.fn(async () => new Map()),
  getFollowedChannels: vi.fn(async () => ({ data: [] })),
  getAllFollowedChannels: vi.fn(async () => []),
}));

vi.mock("@backend/features/discovery/adapters/twitch/category-endpoints", () => ({
  getTopCategories: vi.fn(async () => ({ data: [] })),
  getCategoryById: vi.fn(async () => null),
  getCategoriesByIds: vi.fn(async () => []),
  getAllTopCategories: vi.fn(async () => []),
}));

vi.mock("@backend/features/discovery/adapters/twitch/channel-endpoints", () => ({
  getChannelsById: vi.fn(async () => []),
}));

vi.mock("@backend/features/discovery/adapters/twitch/search-endpoints", () => ({
  searchChannels: vi.fn(async () => ({ data: [] })),
  searchCategories: vi.fn(async () => ({ data: [] })),
}));

vi.mock("@backend/features/playback/adapters/twitch/clip-endpoints", () => ({
  getClipsByBroadcaster: vi.fn(async () => ({ data: [] })),
}));

vi.mock("@backend/features/playback/adapters/twitch/video-endpoints", () => ({
  getVideosByUser: vi.fn(async () => ({ data: [] })),
  getVideoById: vi.fn(async () => null),
}));

import { twitchDiscovery } from "@backend/features/discovery/composition/twitch-discovery";
import * as TwitchAccountEndpoints from "@backend/features/authentication/adapters/twitch/account-endpoints";
import { twitchAuthService } from "@backend/features/authentication/adapters/twitch/twitch-auth";

// Guards: Twitch never broadens an unsupported language filter into unfiltered top streams.
// Guards: Twitch account-follow reads expose an authoritative portable snapshot and contain provider failure.
describe("TwitchClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("platform", () => {
    it("is twitch", () => {
      expect(twitchDiscovery.platform).toBe("twitch");
    });
  });

  describe("readAccountFollows", () => {
    it("returns an authoritative portable snapshot", async () => {
      const follows = [
        {
          id: "1",
          platform: "twitch" as const,
          username: "followed",
          displayName: "Followed",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
        },
      ];
      vi.mocked(TwitchAccountEndpoints.getAllFollowedChannels).mockResolvedValueOnce(follows);

      await expect(twitchAccountReader.readAccountFollows()).resolves.toEqual({
        kind: "available",
        follows,
        authoritative: true,
      });
    });

    it("preserves local state by tagging provider failure as unavailable", async () => {
      vi.mocked(TwitchAccountEndpoints.getAllFollowedChannels).mockRejectedValueOnce(
        new Error("offline")
      );

      await expect(twitchAccountReader.readAccountFollows()).resolves.toEqual({
        kind: "unavailable",
        reason: "offline",
      });
    });
  });

  describe("getStreamsByLogins", () => {
    it("returns streams from GQL on success", async () => {
      const streams = [{ id: "s1", platform: "twitch", channelName: "user1" }];
      mockGqlGetStreamsByLogins.mockResolvedValueOnce(streams);

      const result = await twitchDiscovery.getStreamsByLogins(["user1"]);

      expect(result.data).toEqual(streams);
      expect(mockGqlGetStreamsByLogins).toHaveBeenCalledWith(["user1"]);
    });

    it("preserves GQL failure so callers cannot mistake it for an offline channel", async () => {
      mockGqlGetStreamsByLogins.mockRejectedValueOnce(new Error("GQL failed"));

      await expect(twitchDiscovery.getStreamsByLogins(["user1"])).rejects.toThrow("GQL failed");
    });
  });

  describe("getTopStreams", () => {
    it("returns an empty result for a language Twitch cannot filter exactly", async () => {
      const result = await twitchDiscovery.getTopStreams({ language: "bg" });

      expect(result).toEqual({ data: [] });
      expect(mockGqlGetTopStreams).not.toHaveBeenCalled();
    });

    it("delegates to GQL on success", async () => {
      const streams = { data: [{ id: "s1" }], cursor: "next" };
      mockGqlGetTopStreams.mockResolvedValueOnce(streams);

      const result = await twitchDiscovery.getTopStreams({ first: 10 });

      expect(result).toEqual(streams);
    });

    it("falls back to Helix on GQL failure", async () => {
      mockGqlGetTopStreams.mockRejectedValueOnce(new Error("GQL down"));
      const { getTopStreams } =
        await import("@backend/features/discovery/adapters/twitch/stream-endpoints");
      (getTopStreams as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: [{ id: "helix-s1" }],
      });

      const result = await twitchDiscovery.getTopStreams({ first: 5 });

      expect(result.data).toEqual([{ id: "helix-s1" }]);
    });

    it("normalizes TopStreamsOptions to PaginationOptions", async () => {
      mockGqlGetTopStreams.mockResolvedValueOnce({ data: [] });

      await twitchDiscovery.getTopStreams({
        limit: 15,
        cursor: "pg2",
        categoryId: "cat1",
        language: "fr",
      });

      expect(mockGqlGetTopStreams).toHaveBeenCalledWith(
        expect.objectContaining({
          first: 15,
          after: "pg2",
          gameId: "cat1",
          language: "fr",
        })
      );
    });
  });

  describe("getStreamByLogin", () => {
    it("delegates to GQL on success", async () => {
      const stream = { id: "s1", channelName: "user1" };
      mockGqlGetStreamByLogin.mockResolvedValueOnce(stream);

      const result = await twitchDiscovery.getStreamByLogin("user1");

      expect(result).toEqual(stream);
    });

    it("falls back to Helix on GQL failure", async () => {
      mockGqlGetStreamByLogin.mockRejectedValueOnce(new Error("GQL error"));
      const { getStreamByLogin } =
        await import("@backend/features/discovery/adapters/twitch/stream-endpoints");
      (getStreamByLogin as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: "helix-s1",
      });

      const result = await twitchDiscovery.getStreamByLogin("user1");

      expect(result).toEqual({ id: "helix-s1" });
    });
  });

  describe("getChannelByLogin", () => {
    it("delegates to GQL", async () => {
      const channel = { id: "c1", username: "streamer" };
      mockGqlGetChannelByLogin.mockResolvedValueOnce(channel);

      const result = await twitchDiscovery.getChannelByLogin("streamer");

      expect(result).toEqual(channel);
    });
  });

  describe("searchChannels", () => {
    it("uses Helix when authenticated so search results can paginate channels", async () => {
      const { searchChannels } =
        await import("@backend/features/discovery/adapters/twitch/search-endpoints");
      (searchChannels as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: [{ id: "helix-c1" }],
        cursor: "next",
      });

      const result = await twitchDiscovery.searchChannels("test", { first: 50, after: "pg2" });

      expect(result).toEqual({ data: [{ id: "helix-c1" }], cursor: "next" });
      expect(searchChannels).toHaveBeenCalledWith(twitchTransport, "test", {
        first: 50,
        after: "pg2",
      });
      expect(mockGqlSearchChannels).not.toHaveBeenCalled();
    });

    it("delegates to GQL when logged out", async () => {
      (twitchAuthService.isAuthenticated as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
      const channels = { data: [{ id: "c1" }], cursor: "next" };
      mockGqlSearchChannels.mockResolvedValueOnce(channels);

      const result = await twitchDiscovery.searchChannels("test");

      expect(result).toEqual(channels);
    });

    it("falls back to GQL when authenticated Helix search fails", async () => {
      const { searchChannels } =
        await import("@backend/features/discovery/adapters/twitch/search-endpoints");
      (searchChannels as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Helix error"));
      const channels = { data: [{ id: "gql-c1" }], cursor: "next" };
      mockGqlSearchChannels.mockResolvedValueOnce(channels);

      const result = await twitchDiscovery.searchChannels("test");

      expect(result).toEqual(channels);
    });

    it("does not retry Helix after both search transports fail", async () => {
      const { searchChannels } =
        await import("@backend/features/discovery/adapters/twitch/search-endpoints");
      (searchChannels as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Helix error"));
      mockGqlSearchChannels.mockRejectedValueOnce(new Error("GQL error"));

      await expect(twitchDiscovery.searchChannels("test")).rejects.toThrow("GQL error");
      expect(searchChannels).toHaveBeenCalledTimes(1);
      expect(mockGqlSearchChannels).toHaveBeenCalledTimes(1);
    });
  });

  describe("getTopCategories", () => {
    it("delegates to GQL on success", async () => {
      const cats = { data: [{ id: "g1", name: "JC" }] };
      mockGqlGetTopCategories.mockResolvedValueOnce(cats);

      const result = await twitchDiscovery.getTopCategories();

      expect(result).toEqual(cats);
    });

    it("falls back to Helix on GQL failure", async () => {
      mockGqlGetTopCategories.mockRejectedValueOnce(new Error("GQL error"));

      const result = await twitchDiscovery.getTopCategories();

      expect(result).toBeDefined();
    });
  });

  describe("getAllTopCategories", () => {
    it("delegates to GQL on success", async () => {
      const cats = [{ id: "g1" }, { id: "g2" }];
      mockGqlGetAllTopCategories.mockResolvedValueOnce(cats);

      const result = await twitchDiscovery.getAllTopCategories();

      expect(result).toEqual(cats);
    });

    it("falls back to Helix on GQL failure", async () => {
      mockGqlGetAllTopCategories.mockRejectedValueOnce(new Error("GQL error"));

      const result = await twitchDiscovery.getAllTopCategories();

      expect(result).toBeDefined();
    });
  });

  // Guards: authenticated Twitch category search preserves Helix results while adding aggregate viewer counts.
  describe("searchCategories", () => {
    it("hydrates authenticated Helix results with aggregate viewer counts", async () => {
      const { searchCategories } =
        await import("@backend/features/discovery/adapters/twitch/search-endpoints");
      const helixResult = {
        data: [
          {
            id: "116747788",
            platform: "twitch" as const,
            name: "Pools, Hot Tubs, and Beaches",
            boxArtUrl: "https://helix.test/pools.jpg",
          },
          {
            id: "509658",
            platform: "twitch" as const,
            name: "Just Chatting",
            boxArtUrl: "https://helix.test/chatting.jpg",
          },
        ],
        cursor: "helix-next",
      };
      (searchCategories as ReturnType<typeof vi.fn>).mockResolvedValueOnce(helixResult);
      mockGqlGetCategoryViewerCountsByIds.mockResolvedValueOnce({ "116747788": 3830 });

      const result = await twitchDiscovery.searchCategories("pools", { first: 25 });

      expect(result).toEqual({
        ...helixResult,
        data: [{ ...helixResult.data[0], viewerCount: 3830 }, helixResult.data[1]],
      });
      expect(searchCategories).toHaveBeenCalledWith(twitchTransport, "pools", { first: 25 });
      expect(mockGqlGetCategoryViewerCountsByIds).toHaveBeenCalledWith(["116747788", "509658"]);
      expect(mockGqlSearchCategories).not.toHaveBeenCalled();
    });

    it("returns unchanged Helix results when viewer count hydration fails", async () => {
      const { searchCategories } =
        await import("@backend/features/discovery/adapters/twitch/search-endpoints");
      const helixResult = {
        data: [
          {
            id: "116747788",
            platform: "twitch" as const,
            name: "Pools, Hot Tubs, and Beaches",
            boxArtUrl: "https://helix.test/pools.jpg",
          },
        ],
        cursor: "helix-next",
      };
      (searchCategories as ReturnType<typeof vi.fn>).mockResolvedValueOnce(helixResult);
      mockGqlGetCategoryViewerCountsByIds.mockRejectedValueOnce(new Error("GQL count error"));

      const result = await twitchDiscovery.searchCategories("pools", { first: 25 });

      expect(result).toEqual(helixResult);
      expect(searchCategories).toHaveBeenCalledTimes(1);
      expect(mockGqlGetCategoryViewerCountsByIds).toHaveBeenCalledWith(["116747788"]);
      expect(mockGqlSearchCategories).not.toHaveBeenCalled();
    });

    it("uses public GQL when logged out", async () => {
      (twitchAuthService.isAuthenticated as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
      const cats = { data: [{ id: "g1" }] };
      mockGqlSearchCategories.mockResolvedValueOnce(cats);

      const result = await twitchDiscovery.searchCategories("chat");

      expect(result).toEqual(cats);
      expect(mockGqlGetCategoryViewerCountsByIds).not.toHaveBeenCalled();
    });

    it("falls back once to GQL when authenticated Helix search fails", async () => {
      const { searchCategories } =
        await import("@backend/features/discovery/adapters/twitch/search-endpoints");
      (searchCategories as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Helix error")
      );
      const cats = { data: [{ id: "gql-g1" }] };
      mockGqlSearchCategories.mockResolvedValueOnce(cats);

      const result = await twitchDiscovery.searchCategories("chat");

      expect(result).toEqual(cats);
      expect(searchCategories).toHaveBeenCalledTimes(1);
      expect(mockGqlSearchCategories).toHaveBeenCalledTimes(1);
      expect(mockGqlGetCategoryViewerCountsByIds).not.toHaveBeenCalled();
    });
  });

  describe("getCategoryById", () => {
    it("delegates to GQL on success", async () => {
      const cat = { id: "g1", name: "Just Chatting" };
      mockGqlGetCategoryById.mockResolvedValueOnce(cat);

      const result = await twitchDiscovery.getCategoryById("g1");

      expect(result).toEqual(cat);
    });

    it("falls back to Helix on GQL failure", async () => {
      mockGqlGetCategoryById.mockRejectedValueOnce(new Error("GQL error"));

      const result = await twitchDiscovery.getCategoryById("g1");

      expect(result).toBeDefined();
    });
  });

  describe("getVideosByChannel", () => {
    it("delegates to GQL", async () => {
      const videos = { data: [{ id: "v1" }] };
      mockGqlGetVideosByChannel.mockResolvedValueOnce(videos);

      const result = await twitchPlayback.getVideosByChannel("streamer");

      expect(result).toEqual(videos);
    });
  });

  describe("getVideoById", () => {
    it("delegates to GQL on success", async () => {
      const video = { id: "v1", title: "VOD" };
      mockGqlGetVideoMetadata.mockResolvedValueOnce(video);

      const result = await twitchPlayback.getVideoById("v1");

      expect(result).toEqual(video);
    });

    it("falls back to Helix on GQL failure", async () => {
      mockGqlGetVideoMetadata.mockRejectedValueOnce(new Error("GQL error"));

      const result = await twitchPlayback.getVideoById("v1");

      expect(result).toBeDefined();
    });
  });

  describe("getClipsByChannel", () => {
    it("delegates to GQL", async () => {
      const clips = { data: [{ id: "clip1" }] };
      mockGqlGetClipsByChannel.mockResolvedValueOnce(clips);

      const result = await twitchPlayback.getClipsByChannel("streamer");

      expect(result).toEqual(clips);
    });
  });

  describe("isChannelLive", () => {
    it("delegates to GQL", async () => {
      mockGqlIsChannelLive.mockResolvedValueOnce(true);

      const result = await twitchDiscovery.isChannelLive("streamer");

      expect(result).toBe(true);
    });
  });

  describe("getFollowerCount", () => {
    it("delegates to GQL", async () => {
      mockGqlGetFollowerCount.mockResolvedValueOnce(42000);

      const result = await twitchDiscovery.getFollowerCount("streamer");

      expect(result).toBe(42000);
    });
  });

  describe("Core discovery port contracts", () => {
    it("reads normalized channel Videos and Clips through cursor-preserving ports", async () => {
      const channel = {
        id: "1",
        platform: "twitch" as const,
        username: "streamer",
        displayName: "Streamer",
        avatarUrl: "",
        isLive: false,
        isVerified: false,
        isPartner: false,
      };
      mockGqlGetVideosByChannel.mockResolvedValueOnce({ data: [], cursor: "videos-next" });
      mockGqlGetClipsByChannel.mockResolvedValueOnce({ data: [], cursor: "clips-next" });

      await expect(
        twitchPlayback.readChannelVideos(channel, { limit: 12, cursor: "videos-in" })
      ).resolves.toEqual({ data: [], cursor: "videos-next" });
      await expect(
        twitchPlayback.readChannelClips(channel, { limit: 8, cursor: "clips-in" })
      ).resolves.toEqual({ data: [], cursor: "clips-next" });
      expect(mockGqlGetVideosByChannel).toHaveBeenCalledWith("streamer", {
        first: 12,
        after: "videos-in",
      });
      expect(mockGqlGetClipsByChannel).toHaveBeenCalledWith("streamer", {
        first: 8,
        after: "clips-in",
      });
    });

    it("uses the public category primary with the same request for guests and signed-in users", async () => {
      const { twitchAuthService } =
        await import("@backend/features/authentication/adapters/twitch/twitch-auth");
      const nativeVideos = vi.spyOn(twitchPlayback, "getVideosByGame");
      const nativeClips = vi.spyOn(twitchPlayback, "getClipsByGame");
      const videoPage = { data: [{ id: "recorded-video", isLive: false }], cursor: "video-next" };
      const clipPage = { data: [{ id: "clip-slug" }], cursor: "clip-next" };
      mockGqlGetCategoryVideos.mockResolvedValue(videoPage);
      mockGqlGetCategoryClips.mockResolvedValue(clipPage);
      for (const authenticated of [false, true]) {
        vi.mocked(twitchAuthService.isAuthenticated).mockReturnValue(authenticated);
        await expect(
          twitchPlayback.readCategoryVideos(
            { id: "509660" },
            { limit: 60, cursor: "video-in", sort: "recent" }
          )
        ).resolves.toEqual({ kind: "available", ...videoPage });
        await expect(
          twitchPlayback.readCategoryClips(
            { id: "509660" },
            { limit: 20, cursor: "clip-in", sort: "popular", timeRange: "week" }
          )
        ).resolves.toEqual({ kind: "available", ...clipPage });
      }
      expect(mockGqlGetCategoryVideos).toHaveBeenCalledWith("509660", {
        limit: 60,
        cursor: "video-in",
        sort: "recent",
      });
      expect(mockGqlGetCategoryClips).toHaveBeenCalledWith("509660", {
        limit: 20,
        cursor: "clip-in",
        sort: "popular",
        timeRange: "week",
      });
      expect(nativeVideos).not.toHaveBeenCalled();
      expect(nativeClips).not.toHaveBeenCalled();
    });

    it("returns typed unsupported availability before calling Twitch Category Clips", async () => {
      const getClipsByGame = vi.spyOn(twitchPlayback, "getClipsByGame");

      await expect(
        twitchPlayback.readCategoryClips(
          { id: "509658", name: "Just Chatting" },
          { sort: "recent" }
        )
      ).resolves.toEqual({
        kind: "unsupported",
        reason: "Twitch Category Clips does not support Most Recent ordering",
      });
      expect(getClipsByGame).not.toHaveBeenCalled();
    });

    it("resolves channel slugs and stable IDs through the normalized reference", async () => {
      const channel = {
        id: "1",
        platform: "twitch" as const,
        username: "streamer",
        displayName: "Streamer",
        avatarUrl: "",
        isLive: false,
        isVerified: false,
        isPartner: false,
      };
      const byLogin = vi.spyOn(twitchDiscovery, "getChannelByLogin").mockResolvedValue(channel);
      const byId = vi.spyOn(twitchDiscovery, "getChannelsById").mockResolvedValue([channel]);

      await expect(
        twitchDiscovery.resolveChannel({ kind: "slug", value: "streamer" })
      ).resolves.toEqual(channel);
      await expect(twitchDiscovery.resolveChannel({ kind: "id", value: "1" })).resolves.toEqual(
        channel
      );
      expect(byLogin).toHaveBeenCalledWith("streamer");
      expect(byId).toHaveBeenCalledWith(["1"]);
    });

    it("maps normalized category pagination to top-stream discovery", async () => {
      const getTopStreams = vi
        .spyOn(twitchDiscovery, "getTopStreams")
        .mockResolvedValue({ data: [] });

      await twitchDiscovery.getStreamsByCategory("game-1", {
        limit: 12,
        cursor: "next",
        categoryName: "Game",
        language: "en",
      });

      expect(getTopStreams).toHaveBeenCalledWith({
        categoryId: "game-1",
        limit: 12,
        cursor: "next",
        language: "en",
      });
    });

    it("returns a normalized broad-search collection", async () => {
      const searchChannels = vi
        .spyOn(twitchDiscovery, "searchChannels")
        .mockResolvedValue({ data: [] });
      const searchCategories = vi
        .spyOn(twitchDiscovery, "searchCategories")
        .mockResolvedValue({ data: [] });

      await expect(
        twitchDiscovery.searchDiscovery("game", { limit: 8, includeCategories: true })
      ).resolves.toEqual({ channels: [], categories: [], streams: [] });
      expect(searchChannels).toHaveBeenCalledWith("game", { limit: 8, liveOnly: false });
      expect(searchCategories).toHaveBeenCalledWith("game", { limit: 8 });
    });
  });
});
