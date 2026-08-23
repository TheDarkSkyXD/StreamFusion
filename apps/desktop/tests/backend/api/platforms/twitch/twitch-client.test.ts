import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/logging/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/sleep", () => ({
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/backend/auth/twitch-auth", () => ({
  twitchAuthService: {
    getValidAccessToken: vi.fn(async () => "test-token"),
    isAuthenticated: vi.fn(() => true),
    refreshToken: vi.fn(async () => true),
    getAccessToken: vi.fn(() => "test-token"),
  },
}));

vi.mock("@/backend/auth/oauth-config", () => ({
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
const mockGqlGetVideosByChannel = vi.fn();
const mockGqlGetVideoMetadata = vi.fn();
const mockGqlFetchGamesForVideos = vi.fn();
const mockGqlGetClipsByChannel = vi.fn();
const mockGqlIsChannelLive = vi.fn();
const mockGqlGetFollowerCount = vi.fn();

vi.mock("@/backend/api/platforms/twitch/twitch-gql-client", () => ({
  gqlGetStreamsByLogins: (...args: unknown[]) => mockGqlGetStreamsByLogins(...args),
  gqlGetTopStreams: (...args: unknown[]) => mockGqlGetTopStreams(...args),
  gqlGetStreamByLogin: (...args: unknown[]) => mockGqlGetStreamByLogin(...args),
  gqlGetChannelByLogin: (...args: unknown[]) => mockGqlGetChannelByLogin(...args),
  gqlSearchChannels: (...args: unknown[]) => mockGqlSearchChannels(...args),
  gqlGetTopCategories: (...args: unknown[]) => mockGqlGetTopCategories(...args),
  gqlGetAllTopCategories: (...args: unknown[]) => mockGqlGetAllTopCategories(...args),
  gqlSearchCategories: (...args: unknown[]) => mockGqlSearchCategories(...args),
  gqlGetCategoryById: (...args: unknown[]) => mockGqlGetCategoryById(...args),
  gqlGetVideosByChannel: (...args: unknown[]) => mockGqlGetVideosByChannel(...args),
  gqlGetVideoMetadata: (...args: unknown[]) => mockGqlGetVideoMetadata(...args),
  gqlFetchGamesForVideos: (...args: unknown[]) => mockGqlFetchGamesForVideos(...args),
  gqlGetClipsByChannel: (...args: unknown[]) => mockGqlGetClipsByChannel(...args),
  gqlIsChannelLive: (...args: unknown[]) => mockGqlIsChannelLive(...args),
  gqlGetFollowerCount: (...args: unknown[]) => mockGqlGetFollowerCount(...args),
}));

vi.mock("@/backend/api/platforms/twitch/endpoints/stream-endpoints", () => ({
  getFollowedStreams: vi.fn(async () => ({ data: [] })),
  getStreamsByUserIds: vi.fn(async () => ({ data: [] })),
  getTopStreams: vi.fn(async () => ({ data: [] })),
  getStreamByLogin: vi.fn(async () => null),
}));

vi.mock("@/backend/api/platforms/twitch/endpoints/user-endpoints", () => ({
  getUser: vi.fn(async () => null),
  getUsersById: vi.fn(async () => []),
  getUsersByLogin: vi.fn(async () => []),
  getFollowedChannels: vi.fn(async () => ({ data: [] })),
  getAllFollowedChannels: vi.fn(async () => []),
}));

vi.mock("@/backend/api/platforms/twitch/endpoints/category-endpoints", () => ({
  getTopCategories: vi.fn(async () => ({ data: [] })),
  getCategoryById: vi.fn(async () => null),
  getCategoriesByIds: vi.fn(async () => []),
  getAllTopCategories: vi.fn(async () => []),
}));

vi.mock("@/backend/api/platforms/twitch/endpoints/channel-endpoints", () => ({
  getChannelsById: vi.fn(async () => []),
}));

vi.mock("@/backend/api/platforms/twitch/endpoints/search-endpoints", () => ({
  searchChannels: vi.fn(async () => ({ data: [] })),
  searchCategories: vi.fn(async () => ({ data: [] })),
}));

vi.mock("@/backend/api/platforms/twitch/endpoints/clip-endpoints", () => ({
  getClipsByBroadcaster: vi.fn(async () => ({ data: [] })),
}));

vi.mock("@/backend/api/platforms/twitch/endpoints/video-endpoints", () => ({
  getVideosByUser: vi.fn(async () => ({ data: [] })),
  getVideoById: vi.fn(async () => null),
}));

vi.mock("@/backend/api/unified/registry", () => ({
  clients: {
    register: vi.fn(),
  },
}));

import { twitchClient } from "@/backend/api/platforms/twitch/twitch-client";
import { twitchAuthService } from "@/backend/auth/twitch-auth";

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

    it("returns empty data on GQL failure", async () => {
      mockGqlGetStreamsByLogins.mockRejectedValueOnce(new Error("GQL failed"));

      const result = await twitchClient.getStreamsByLogins(["user1"]);

      expect(result.data).toEqual([]);
    });
  });

  describe("getTopStreams", () => {
    it("delegates to GQL on success", async () => {
      const streams = { data: [{ id: "s1" }], cursor: "next" };
      mockGqlGetTopStreams.mockResolvedValueOnce(streams);

      const result = await twitchClient.getTopStreams({ first: 10 });

      expect(result).toEqual(streams);
    });

    it("falls back to Helix on GQL failure", async () => {
      mockGqlGetTopStreams.mockRejectedValueOnce(new Error("GQL down"));
      const { getTopStreams } = await import(
        "@/backend/api/platforms/twitch/endpoints/stream-endpoints"
      );
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
      const { getStreamByLogin } = await import(
        "@/backend/api/platforms/twitch/endpoints/stream-endpoints"
      );
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
      const { searchChannels } = await import(
        "@/backend/api/platforms/twitch/endpoints/search-endpoints"
      );
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
      const { searchChannels } = await import(
        "@/backend/api/platforms/twitch/endpoints/search-endpoints"
      );
      (searchChannels as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Helix error"));
      const channels = { data: [{ id: "gql-c1" }], cursor: "next" };
      mockGqlSearchChannels.mockResolvedValueOnce(channels);

      const result = await twitchClient.searchChannels("test");

      expect(result).toEqual(channels);
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

  describe("searchCategories", () => {
    it("delegates to GQL on success", async () => {
      const cats = { data: [{ id: "g1" }] };
      mockGqlSearchCategories.mockResolvedValueOnce(cats);

      const result = await twitchClient.searchCategories("chat");

      expect(result).toEqual(cats);
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
      const { twitchAuthService } = await import("@/backend/auth/twitch-auth");
      (twitchAuthService.isAuthenticated as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

      const result = await twitchClient.getStreamsByUserIds(["u1"]);

      expect(result.data).toEqual([]);
    });
  });
});
