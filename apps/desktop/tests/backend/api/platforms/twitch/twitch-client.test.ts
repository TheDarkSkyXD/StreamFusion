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

vi.mock("@backend/auth/twitch-auth", () => ({
  twitchAuthService: {
    getValidAccessToken: vi.fn(async () => "test-token"),
    isAuthenticated: vi.fn(() => true),
    refreshToken: vi.fn(async () => true),
    getAccessToken: vi.fn(() => "test-token"),
  },
}));

vi.mock("@backend/auth/oauth-config", () => ({
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

vi.mock("@backend/api/platforms/twitch/twitch-gql-client", () => ({
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
  gqlGetVideosByChannel: (...args: unknown[]) => mockGqlGetVideosByChannel(...args),
  gqlGetVideoMetadata: (...args: unknown[]) => mockGqlGetVideoMetadata(...args),
  gqlFetchGamesForVideos: (...args: unknown[]) => mockGqlFetchGamesForVideos(...args),
  gqlGetClipsByChannel: (...args: unknown[]) => mockGqlGetClipsByChannel(...args),
  gqlIsChannelLive: (...args: unknown[]) => mockGqlIsChannelLive(...args),
  gqlGetFollowerCount: (...args: unknown[]) => mockGqlGetFollowerCount(...args),
}));

vi.mock("@backend/api/platforms/twitch/endpoints/stream-endpoints", () => ({
  getFollowedStreams: vi.fn(async () => ({ data: [] })),
  getStreamsByUserIds: vi.fn(async () => ({ data: [] })),
  getTopStreams: vi.fn(async () => ({ data: [] })),
  getStreamByLogin: vi.fn(async () => null),
}));

vi.mock("@backend/api/platforms/twitch/endpoints/user-endpoints", () => ({
  getUser: vi.fn(async () => null),
  getUsersById: vi.fn(async () => []),
  getUsersByLogin: vi.fn(async () => []),
  getFollowerCounts: vi.fn(async () => new Map()),
  getFollowedChannels: vi.fn(async () => ({ data: [] })),
  getAllFollowedChannels: vi.fn(async () => []),
}));

vi.mock("@backend/api/platforms/twitch/endpoints/category-endpoints", () => ({
  getTopCategories: vi.fn(async () => ({ data: [] })),
  getCategoryById: vi.fn(async () => null),
  getCategoriesByIds: vi.fn(async () => []),
  getAllTopCategories: vi.fn(async () => []),
}));

vi.mock("@backend/api/platforms/twitch/endpoints/channel-endpoints", () => ({
  getChannelsById: vi.fn(async () => []),
}));

vi.mock("@backend/api/platforms/twitch/endpoints/search-endpoints", () => ({
  searchChannels: vi.fn(async () => ({ data: [] })),
  searchCategories: vi.fn(async () => ({ data: [] })),
}));

vi.mock("@backend/api/platforms/twitch/endpoints/clip-endpoints", () => ({
  getClipsByBroadcaster: vi.fn(async () => ({ data: [] })),
}));

vi.mock("@backend/api/platforms/twitch/endpoints/video-endpoints", () => ({
  getVideosByUser: vi.fn(async () => ({ data: [] })),
  getVideoById: vi.fn(async () => null),
}));

import { twitchClient } from "@backend/api/platforms/twitch/twitch-client";
import { twitchAuthService } from "@backend/auth/twitch-auth";

// Guards: Twitch never broadens an unsupported language filter into unfiltered top streams.
describe("TwitchClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("platform", () => {
    it("is twitch", () => {
      expect(twitchClient.platform).toBe("twitch");
    });
  });

  describe("getStreamsByLogins", () => {
    it("returns streams from GQL on success", async () => {
      const streams = [{ id: "s1", platform: "twitch", channelName: "user1" }];
      mockGqlGetStreamsByLogins.mockResolvedValueOnce(streams);

      const result = await twitchClient.getStreamsByLogins(["user1"]);

      expect(result.data).toEqual(streams);
      expect(mockGqlGetStreamsByLogins).toHaveBeenCalledWith(["user1"]);
    });

    it("preserves GQL failure so callers cannot mistake it for an offline channel", async () => {
      mockGqlGetStreamsByLogins.mockRejectedValueOnce(new Error("GQL failed"));

      await expect(twitchClient.getStreamsByLogins(["user1"])).rejects.toThrow("GQL failed");
    });
  });

  describe("getTopStreams", () => {
    it("returns an empty result for a language Twitch cannot filter exactly", async () => {
      const result = await twitchClient.getTopStreams({ language: "bg" });

      expect(result).toEqual({ data: [] });
      expect(mockGqlGetTopStreams).not.toHaveBeenCalled();
    });

    it("delegates to GQL on success", async () => {
      const streams = { data: [{ id: "s1" }], cursor: "next" };
      mockGqlGetTopStreams.mockResolvedValueOnce(streams);

      const result = await twitchClient.getTopStreams({ first: 10 });

      expect(result).toEqual(streams);
    });

    it("falls back to Helix on GQL failure", async () => {
      mockGqlGetTopStreams.mockRejectedValueOnce(new Error("GQL down"));
      const { getTopStreams } =
        await import("@backend/api/platforms/twitch/endpoints/stream-endpoints");
      (getTopStreams as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: [{ id: "helix-s1" }],
      });

      const result = await twitchClient.getTopStreams({ first: 5 });

      expect(result.data).toEqual([{ id: "helix-s1" }]);
    });

    it("normalizes TopStreamsOptions to PaginationOptions", async () => {
      mockGqlGetTopStreams.mockResolvedValueOnce({ data: [] });

      await twitchClient.getTopStreams({
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

      const result = await twitchClient.getStreamByLogin("user1");

      expect(result).toEqual(stream);
    });

    it("falls back to Helix on GQL failure", async () => {
      mockGqlGetStreamByLogin.mockRejectedValueOnce(new Error("GQL error"));
      const { getStreamByLogin } =
        await import("@backend/api/platforms/twitch/endpoints/stream-endpoints");
      (getStreamByLogin as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: "helix-s1",
      });

      const result = await twitchClient.getStreamByLogin("user1");

      expect(result).toEqual({ id: "helix-s1" });
    });
  });

  describe("getChannelByLogin", () => {
    it("delegates to GQL", async () => {
      const channel = { id: "c1", username: "streamer" };
      mockGqlGetChannelByLogin.mockResolvedValueOnce(channel);

      const result = await twitchClient.getChannelByLogin("streamer");

      expect(result).toEqual(channel);
    });
  });

  describe("searchChannels", () => {
    it("uses Helix when authenticated so search results can paginate channels", async () => {
      const { searchChannels } =
        await import("@backend/api/platforms/twitch/endpoints/search-endpoints");
      (searchChannels as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: [{ id: "helix-c1" }],
        cursor: "next",
      });

      const result = await twitchClient.searchChannels("test", { first: 50, after: "pg2" });

      expect(result).toEqual({ data: [{ id: "helix-c1" }], cursor: "next" });
      expect(searchChannels).toHaveBeenCalledWith(twitchClient, "test", {
        first: 50,
        after: "pg2",
      });
      expect(mockGqlSearchChannels).not.toHaveBeenCalled();
    });

    it("delegates to GQL when logged out", async () => {
      (twitchAuthService.isAuthenticated as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
      const channels = { data: [{ id: "c1" }], cursor: "next" };
      mockGqlSearchChannels.mockResolvedValueOnce(channels);

      const result = await twitchClient.searchChannels("test");

      expect(result).toEqual(channels);
    });

    it("falls back to GQL when authenticated Helix search fails", async () => {
      const { searchChannels } =
        await import("@backend/api/platforms/twitch/endpoints/search-endpoints");
      (searchChannels as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Helix error"));
      const channels = { data: [{ id: "gql-c1" }], cursor: "next" };
      mockGqlSearchChannels.mockResolvedValueOnce(channels);

      const result = await twitchClient.searchChannels("test");

      expect(result).toEqual(channels);
    });

    it("does not retry Helix after both search transports fail", async () => {
      const { searchChannels } =
        await import("@backend/api/platforms/twitch/endpoints/search-endpoints");
      (searchChannels as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Helix error"));
      mockGqlSearchChannels.mockRejectedValueOnce(new Error("GQL error"));

      await expect(twitchClient.searchChannels("test")).rejects.toThrow("GQL error");
      expect(searchChannels).toHaveBeenCalledTimes(1);
      expect(mockGqlSearchChannels).toHaveBeenCalledTimes(1);
    });
  });

  describe("getTopCategories", () => {
    it("delegates to GQL on success", async () => {
      const cats = { data: [{ id: "g1", name: "JC" }] };
      mockGqlGetTopCategories.mockResolvedValueOnce(cats);

      const result = await twitchClient.getTopCategories();

      expect(result).toEqual(cats);
    });

    it("falls back to Helix on GQL failure", async () => {
      mockGqlGetTopCategories.mockRejectedValueOnce(new Error("GQL error"));

      const result = await twitchClient.getTopCategories();

      expect(result).toBeDefined();
    });
  });

  describe("getAllTopCategories", () => {
    it("delegates to GQL on success", async () => {
      const cats = [{ id: "g1" }, { id: "g2" }];
      mockGqlGetAllTopCategories.mockResolvedValueOnce(cats);

      const result = await twitchClient.getAllTopCategories();

      expect(result).toEqual(cats);
    });

    it("falls back to Helix on GQL failure", async () => {
      mockGqlGetAllTopCategories.mockRejectedValueOnce(new Error("GQL error"));

      const result = await twitchClient.getAllTopCategories();

      expect(result).toBeDefined();
    });
  });

  // Guards: authenticated Twitch category search preserves Helix results while adding aggregate viewer counts.
  describe("searchCategories", () => {
    it("hydrates authenticated Helix results with aggregate viewer counts", async () => {
      const { searchCategories } =
        await import("@backend/api/platforms/twitch/endpoints/search-endpoints");
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

      const result = await twitchClient.searchCategories("pools", { first: 25 });

      expect(result).toEqual({
        ...helixResult,
        data: [{ ...helixResult.data[0], viewerCount: 3830 }, helixResult.data[1]],
      });
      expect(searchCategories).toHaveBeenCalledWith(twitchClient, "pools", { first: 25 });
      expect(mockGqlGetCategoryViewerCountsByIds).toHaveBeenCalledWith(["116747788", "509658"]);
      expect(mockGqlSearchCategories).not.toHaveBeenCalled();
    });

    it("returns unchanged Helix results when viewer count hydration fails", async () => {
      const { searchCategories } =
        await import("@backend/api/platforms/twitch/endpoints/search-endpoints");
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

      const result = await twitchClient.searchCategories("pools", { first: 25 });

      expect(result).toEqual(helixResult);
      expect(searchCategories).toHaveBeenCalledTimes(1);
      expect(mockGqlGetCategoryViewerCountsByIds).toHaveBeenCalledWith(["116747788"]);
      expect(mockGqlSearchCategories).not.toHaveBeenCalled();
    });

    it("uses public GQL when logged out", async () => {
      (twitchAuthService.isAuthenticated as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
      const cats = { data: [{ id: "g1" }] };
      mockGqlSearchCategories.mockResolvedValueOnce(cats);

      const result = await twitchClient.searchCategories("chat");

      expect(result).toEqual(cats);
      expect(mockGqlGetCategoryViewerCountsByIds).not.toHaveBeenCalled();
    });

    it("falls back once to GQL when authenticated Helix search fails", async () => {
      const { searchCategories } =
        await import("@backend/api/platforms/twitch/endpoints/search-endpoints");
      (searchCategories as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Helix error")
      );
      const cats = { data: [{ id: "gql-g1" }] };
      mockGqlSearchCategories.mockResolvedValueOnce(cats);

      const result = await twitchClient.searchCategories("chat");

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

      const result = await twitchClient.getCategoryById("g1");

      expect(result).toEqual(cat);
    });

    it("falls back to Helix on GQL failure", async () => {
      mockGqlGetCategoryById.mockRejectedValueOnce(new Error("GQL error"));

      const result = await twitchClient.getCategoryById("g1");

      expect(result).toBeDefined();
    });
  });

  describe("getVideosByChannel", () => {
    it("delegates to GQL", async () => {
      const videos = { data: [{ id: "v1" }] };
      mockGqlGetVideosByChannel.mockResolvedValueOnce(videos);

      const result = await twitchClient.getVideosByChannel("streamer");

      expect(result).toEqual(videos);
    });
  });

  describe("getVideoById", () => {
    it("delegates to GQL on success", async () => {
      const video = { id: "v1", title: "VOD" };
      mockGqlGetVideoMetadata.mockResolvedValueOnce(video);

      const result = await twitchClient.getVideoById("v1");

      expect(result).toEqual(video);
    });

    it("falls back to Helix on GQL failure", async () => {
      mockGqlGetVideoMetadata.mockRejectedValueOnce(new Error("GQL error"));

      const result = await twitchClient.getVideoById("v1");

      expect(result).toBeDefined();
    });
  });

  describe("getClipsByChannel", () => {
    it("delegates to GQL", async () => {
      const clips = { data: [{ id: "clip1" }] };
      mockGqlGetClipsByChannel.mockResolvedValueOnce(clips);

      const result = await twitchClient.getClipsByChannel("streamer");

      expect(result).toEqual(clips);
    });
  });

  describe("isChannelLive", () => {
    it("delegates to GQL", async () => {
      mockGqlIsChannelLive.mockResolvedValueOnce(true);

      const result = await twitchClient.isChannelLive("streamer");

      expect(result).toBe(true);
    });
  });

  describe("getFollowerCount", () => {
    it("delegates to GQL", async () => {
      mockGqlGetFollowerCount.mockResolvedValueOnce(42000);

      const result = await twitchClient.getFollowerCount("streamer");

      expect(result).toBe(42000);
    });
  });

  describe("getStreamsByUserIds", () => {
    it("returns empty data when not authenticated and no GQL fallback", async () => {
      const { twitchAuthService } = await import("@backend/auth/twitch-auth");
      (twitchAuthService.isAuthenticated as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

      const result = await twitchClient.getStreamsByUserIds(["u1"]);

      expect(result.data).toEqual([]);
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
        twitchClient.readChannelVideos(channel, { limit: 12, cursor: "videos-in" })
      ).resolves.toEqual({ data: [], cursor: "videos-next" });
      await expect(
        twitchClient.readChannelClips(channel, { limit: 8, cursor: "clips-in" })
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

    it("normalizes native Category Videos and keeps provider enrichment Desktop-owned", async () => {
      vi.spyOn(twitchClient, "getVideosByGame").mockResolvedValueOnce({
        data: [
          {
            id: "video-1",
            stream_id: null,
            user_id: "channel-1",
            user_login: "streamer",
            user_name: "Streamer",
            title: "Category VOD",
            description: "",
            created_at: "2026-01-01T00:00:00Z",
            published_at: "2026-01-01T00:00:00Z",
            url: "https://twitch.tv/videos/video-1",
            thumbnail_url: "https://thumb/%{width}x%{height}.jpg",
            viewable: "public",
            view_count: 42,
            language: "en",
            type: "archive",
            duration: "1h2m3s",
            muted_segments: null,
            game_id: "509658",
            game_name: "Just Chatting",
          },
        ],
        cursor: "next",
      });
      vi.spyOn(twitchClient, "getUsersById").mockResolvedValueOnce([
        {
          id: "channel-1",
          login: "streamer",
          displayName: "Streamer",
          profileImageUrl: "https://avatar.jpg",
          createdAt: "2020-01-01T00:00:00Z",
          broadcasterType: "",
        },
      ]);

      const result = await twitchClient.readCategoryVideos(
        { id: "509658", name: "Just Chatting" },
        { limit: 12, cursor: "in", sort: "popular", language: "en" }
      );

      expect(result).toEqual({
        kind: "available",
        data: [
          expect.objectContaining({
            id: "video-1",
            platform: "twitch",
            duration: 3_723,
            viewCount: 42,
            categoryId: "509658",
            categoryName: "Just Chatting",
            channelAvatar: "https://avatar.jpg",
            language: "en",
          }),
        ],
        cursor: "next",
      });
      expect(twitchClient.getVideosByGame).toHaveBeenCalledWith("509658", {
        first: 12,
        after: "in",
        sort: "views",
      });
    });

    it("uses live streams only to discover channels and never returns them as Category Videos", async () => {
      vi.spyOn(twitchClient, "getVideosByGame").mockResolvedValueOnce({ data: [] });
      vi.spyOn(twitchClient, "getStreamsByCategory").mockResolvedValueOnce({
        data: [
          {
            id: "live-stream-1",
            platform: "twitch",
            channelId: "channel-1",
            channelName: "streamer",
            channelDisplayName: "Streamer",
            channelAvatar: "https://avatar.jpg",
            title: "Currently live",
            viewerCount: 50_000,
            thumbnailUrl: "https://live-thumb.jpg",
            isLive: true,
            startedAt: "2026-09-04T16:00:00.000Z",
            language: "en",
            tags: [],
          },
        ],
        cursor: "streams-next",
      });
      vi.spyOn(twitchClient, "getVideosByChannel").mockResolvedValueOnce({
        data: [
          {
            id: "archived-vod-1",
            platform: "twitch",
            channelId: "channel-1",
            channelName: "streamer",
            channelDisplayName: "Streamer",
            channelAvatar: "https://avatar.jpg",
            title: "Archived VOD",
            thumbnailUrl: "https://vod-thumb.jpg",
            duration: 3_600,
            viewCount: 10_000,
            publishedAt: "2026-09-03T12:00:00.000Z",
            url: "https://twitch.tv/videos/archived-vod-1",
            type: "archive",
          },
          {
            id: "in-progress-recording",
            platform: "twitch",
            channelId: "channel-1",
            channelName: "streamer",
            channelDisplayName: "Streamer",
            channelAvatar: "https://avatar.jpg",
            title: "Current live recording",
            thumbnailUrl: "https://live-thumb.jpg",
            duration: 120,
            viewCount: 50_000,
            publishedAt: "2026-09-04T16:00:00.000Z",
            url: "https://twitch.tv/videos/in-progress-recording",
            type: "archive",
            isLive: true,
          },
          {
            id: "unrelated-vod",
            platform: "twitch",
            channelId: "channel-1",
            channelName: "streamer",
            channelDisplayName: "Streamer",
            channelAvatar: "https://avatar.jpg",
            title: "Unrelated archived VOD",
            thumbnailUrl: "https://unrelated-thumb.jpg",
            duration: 7_200,
            viewCount: 20_000,
            publishedAt: "2026-09-02T12:00:00.000Z",
            url: "https://twitch.tv/videos/unrelated-vod",
            type: "archive",
          },
        ],
      });
      vi.spyOn(twitchClient, "getVideosGameData").mockResolvedValueOnce({
        "archived-vod-1": { id: "509658", name: "Just Chatting" },
        "in-progress-recording": { id: "509658", name: "Just Chatting" },
        "unrelated-vod": { id: "21779", name: "League of Legends" },
      });

      const result = await twitchClient.readCategoryVideos(
        { id: "509658", name: "Just Chatting" },
        { limit: 20, sort: "recent" }
      );

      expect(result).toMatchObject({
        kind: "available",
        data: [{ id: "archived-vod-1", title: "Archived VOD" }],
        cursor: "channels:streams-next",
      });
      if (result.kind === "available") {
        expect(result.data.every((video) => video.isLive !== true)).toBe(true);
        expect(result.data.map((video) => video.id)).not.toContain("live-stream-1");
        expect(result.data.map((video) => video.id)).not.toContain("in-progress-recording");
        expect(result.data.map((video) => video.id)).not.toContain("unrelated-vod");
      }
      expect(twitchClient.getVideosByChannel).toHaveBeenCalledWith("streamer", { first: 5 });
      expect(twitchClient.getVideosGameData).toHaveBeenCalledWith([
        "archived-vod-1",
        "in-progress-recording",
        "unrelated-vod",
      ]);
    });

    it("returns typed unsupported availability before calling Twitch Category Clips", async () => {
      const getClipsByGame = vi.spyOn(twitchClient, "getClipsByGame");

      await expect(
        twitchClient.readCategoryClips({ id: "509658", name: "Just Chatting" }, { sort: "recent" })
      ).resolves.toEqual({
        kind: "unsupported",
        reason: "Twitch Helix Category Clips does not support Most Recent ordering",
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
      const byLogin = vi.spyOn(twitchClient, "getChannelByLogin").mockResolvedValue(channel);
      const byId = vi.spyOn(twitchClient, "getChannelsById").mockResolvedValue([channel]);

      await expect(
        twitchClient.resolveChannel({ kind: "slug", value: "streamer" })
      ).resolves.toEqual(channel);
      await expect(twitchClient.resolveChannel({ kind: "id", value: "1" })).resolves.toEqual(
        channel
      );
      expect(byLogin).toHaveBeenCalledWith("streamer");
      expect(byId).toHaveBeenCalledWith(["1"]);
    });

    it("maps normalized category pagination to top-stream discovery", async () => {
      const getTopStreams = vi.spyOn(twitchClient, "getTopStreams").mockResolvedValue({ data: [] });

      await twitchClient.getStreamsByCategory("game-1", {
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
        .spyOn(twitchClient, "searchChannels")
        .mockResolvedValue({ data: [] });
      const searchCategories = vi
        .spyOn(twitchClient, "searchCategories")
        .mockResolvedValue({ data: [] });

      await expect(
        twitchClient.searchDiscovery("game", { limit: 8, includeCategories: true })
      ).resolves.toEqual({ channels: [], categories: [], streams: [] });
      expect(searchChannels).toHaveBeenCalledWith("game", { limit: 8, liveOnly: false });
      expect(searchCategories).toHaveBeenCalledWith("game", { limit: 8 });
    });
  });
});
