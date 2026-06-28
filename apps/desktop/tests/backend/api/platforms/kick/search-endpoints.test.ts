import Module from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ *
 * Electron mock: search-endpoints.ts uses `require("electron")` (CJS)*
 * inside function bodies. vi.mock only intercepts ESM imports.        *
 * ------------------------------------------------------------------ */
const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

const _origRequire = Module.prototype.require;
(Module.prototype as any).require = function (id: string) {
  if (id === "electron") {
    return { net: { fetch: (...args: unknown[]) => mockFetch(...args) } };
  }
  return _origRequire.apply(this, [id] as any);
};

vi.mock("@/backend/api/platforms/kick/kick-network-health", () => ({
  acquireKickRequestSlot: vi.fn(async () => () => {}),
}));

vi.mock("@/lib/managed-interval", () => ({
  createManagedInterval: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/stream-endpoints", () => ({
  getStreamBySlug: vi.fn().mockResolvedValue(null),
  getPublicTopStreams: vi.fn().mockResolvedValue({ data: [] }),
  rememberCategorySlug: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/channel-endpoints", () => ({
  getChannel: vi.fn().mockResolvedValue(null),
  getPublicChannel: vi.fn().mockResolvedValue(null),
  acquireBrowserWindowSlot: vi.fn(async () => vi.fn()),
  mapKickChatroomToSettings: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/category-endpoints", () => ({
  searchCategories: vi.fn().mockResolvedValue({ data: [] }),
}));

import { searchCategories } from "@/backend/api/platforms/kick/endpoints/category-endpoints";
import {
  getChannel,
  getPublicChannel,
} from "@/backend/api/platforms/kick/endpoints/channel-endpoints";
import { search, searchChannels } from "@/backend/api/platforms/kick/endpoints/search-endpoints";
import {
  getPublicTopStreams,
  getStreamBySlug,
} from "@/backend/api/platforms/kick/endpoints/stream-endpoints";
import type { KickRequestor } from "@/backend/api/platforms/kick/kick-requestor";

function createMockClient(overrides: Partial<KickRequestor> = {}): KickRequestor {
  return {
    request: vi.fn(),
    isAuthenticated: vi.fn(() => true),
    baseUrl: "https://test.example.com",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Guards: Kick channel search suggestions must not use the hidden BrowserWindow channel lookup path.
// Guards: Kick full search should parallelize independent category/channel/stream work where possible.
describe("search-endpoints", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.mocked(getPublicChannel).mockReset().mockResolvedValue(null);
    vi.mocked(getChannel).mockReset().mockResolvedValue(null);
    vi.mocked(getPublicTopStreams).mockReset().mockResolvedValue({ data: [] });
    vi.mocked(getStreamBySlug).mockReset().mockResolvedValue(null);
    vi.mocked(searchCategories).mockReset().mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("searchChannels", () => {
    it("does not use the BrowserWindow public channel path for live search suggestions", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          channels: [
            {
              id: 100,
              slug: "streamer",
              username: "Streamer",
              followers_count: 5000,
            },
          ],
        })
      );

      const client = createMockClient();
      const result = await searchChannels(client, "streamer");

      expect(getPublicChannel).not.toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].username).toBe("streamer");
      expect(result.data[0].followerCount).toBe(5000);
    });

    it("returns results from public search endpoint (Step 2)", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          channels: [
            {
              id: 200,
              slug: "search-result",
              username: "SearchResult",
              followers_count: 5000,
            },
          ],
        })
      );

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await searchChannels(client, "search");

      expect(result.data.length).toBeGreaterThanOrEqual(1);
      const found = result.data.find((c) => c.username === "search-result");
      expect(found).toBeDefined();
      expect(found!.followerCount).toBe(5000);
    });

    it("deduplicates by username (slug) across steps", async () => {
      vi.mocked(getPublicChannel).mockResolvedValueOnce({
        id: "100",
        platform: "kick",
        username: "dup-channel",
        displayName: "DupChannel",
        avatarUrl: "https://example.com/avatar.webp",
        bannerUrl: "",
        bio: "",
        isLive: true,
        isVerified: false,
        isPartner: false,
      });

      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          channels: [{ id: 100, slug: "dup-channel", username: "DupChannel" }],
        })
      );

      vi.mocked(getPublicTopStreams).mockResolvedValueOnce({
        data: [
          {
            id: "stream-1",
            platform: "kick",
            channelId: "100",
            channelName: "dup-channel",
            channelDisplayName: "DupChannel",
            channelAvatar: "",
            title: "Live",
            viewerCount: 50,
            thumbnailUrl: "",
            isLive: true,
            startedAt: "",
          } as any,
        ],
      });

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await searchChannels(client, "dup-channel");

      const matches = result.data.filter((c) => c.username.toLowerCase() === "dup-channel");
      expect(matches).toHaveLength(1);
    });

    it("merges avatar from top streams with follower count from public search", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          channels: [
            {
              id: 100,
              slug: "merge-test",
              username: "MergeTest",
              followers_count: 10000,
            },
          ],
        })
      );
      vi.mocked(getPublicTopStreams).mockResolvedValueOnce({
        data: [
          {
            id: "stream-1",
            platform: "kick",
            channelId: "100",
            channelName: "merge-test",
            channelDisplayName: "MergeTest",
            channelAvatar: "https://example.com/avatar.webp",
            title: "Live",
            viewerCount: 50,
            thumbnailUrl: "",
            isLive: true,
            startedAt: "",
          } as any,
        ],
      });

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await searchChannels(client, "merge-test");

      const channel = result.data.find((c) => c.username === "merge-test");
      expect(channel).toBeDefined();
      expect(channel!.avatarUrl).toBe("https://example.com/avatar.webp");
      expect(channel!.followerCount).toBe(10000);
    });

    it("preserves verified metadata when merging live stream fallback results", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          channels: [
            {
              id: 100,
              slug: "verified-merge",
              username: "VerifiedMerge",
              verified: true,
            },
          ],
        })
      );
      vi.mocked(getPublicTopStreams).mockResolvedValueOnce({
        data: [
          {
            id: "stream-1",
            platform: "kick",
            channelId: "100",
            channelName: "verified-merge",
            channelDisplayName: "VerifiedMerge",
            channelAvatar: "https://example.com/avatar.webp",
            title: "Live",
            viewerCount: 50,
            thumbnailUrl: "",
            isLive: true,
            startedAt: "",
          } as any,
        ],
      });

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await searchChannels(client, "verified-merge");

      const channel = result.data.find((c) => c.username === "verified-merge");
      expect(channel).toBeDefined();
      expect(channel!.avatarUrl).toBe("https://example.com/avatar.webp");
      expect(channel!.isVerified).toBe(true);
    });

    it("includes fuzzy matches from top streams (Step 4)", async () => {
      vi.mocked(getPublicTopStreams).mockResolvedValueOnce({
        data: [
          {
            id: "s1",
            platform: "kick",
            channelId: "300",
            channelName: "fuzzy-match",
            channelDisplayName: "FuzzyMatch",
            channelAvatar: "https://example.com/av.webp",
            title: "Playing",
            viewerCount: 1000,
            thumbnailUrl: "",
            isLive: true,
            startedAt: "",
          } as any,
        ],
      });

      mockFetch.mockResolvedValueOnce(jsonResponse({ channels: [] }));

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await searchChannels(client, "fuzzy");

      const found = result.data.find((c) => c.username === "fuzzy-match");
      expect(found).toBeDefined();
      expect(found!.isLive).toBe(true);
    });

    it("pages live-channel matches for one-letter Kick search results", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ channels: [] }));
      vi.mocked(getPublicTopStreams)
        .mockResolvedValueOnce({
          data: [
            {
              id: "s1",
              platform: "kick",
              channelId: "1",
              channelName: "alpha",
              channelDisplayName: "Alpha",
              channelAvatar: "https://example.com/a.webp",
              title: "Live",
              viewerCount: 100,
              thumbnailUrl: "",
              isLive: true,
              startedAt: "",
            } as any,
            {
              id: "s2",
              platform: "kick",
              channelId: "2",
              channelName: "bravo",
              channelDisplayName: "Bravo",
              channelAvatar: "https://example.com/b.webp",
              title: "Live",
              viewerCount: 90,
              thumbnailUrl: "",
              isLive: true,
              startedAt: "",
            } as any,
          ],
          cursor: "100",
        })
        .mockResolvedValueOnce({
          data: [
            {
              id: "s3",
              platform: "kick",
              channelId: "3",
              channelName: "charlie",
              channelDisplayName: "Charlie",
              channelAvatar: "https://example.com/c.webp",
              title: "Live",
              viewerCount: 80,
              thumbnailUrl: "",
              isLive: true,
              startedAt: "",
            } as any,
          ],
          cursor: "200",
        });

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const firstPage = await searchChannels(client, "a", { limit: 2 });
      const secondPage = await searchChannels(client, "a", { cursor: firstPage.cursor, limit: 1 });

      expect(firstPage.data.map((c) => c.username)).toEqual(["alpha", "bravo"]);
      expect(firstPage.cursor).toBe("100");
      expect(secondPage.data.map((c) => c.username)).toEqual(["charlie"]);
      expect(secondPage.cursor).toBe("200");
      expect(getPublicTopStreams).toHaveBeenNthCalledWith(2, {
        limit: 100,
        cursor: "100",
      });
    });

    it("uses authenticated API (Step 3) when client is authenticated", async () => {
      vi.mocked(getChannel).mockResolvedValueOnce({
        id: "400",
        platform: "kick",
        username: "auth-channel",
        displayName: "AuthChannel",
        avatarUrl: "https://example.com/auth-av.webp",
        bannerUrl: "",
        bio: "",
        isLive: false,
        isVerified: true,
        isPartner: false,
      });

      mockFetch.mockResolvedValueOnce(jsonResponse({ channels: [] }));

      const client = createMockClient();
      const result = await searchChannels(client, "auth-channel");

      expect(getChannel).toHaveBeenCalledWith(client, "auth-channel");
      const found = result.data.find((c) => c.username === "auth-channel");
      expect(found).toBeDefined();
    });

    it("skips Step 3 when client is not authenticated", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ channels: [] }));

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      await searchChannels(client, "test");

      expect(getChannel).not.toHaveBeenCalled();
    });

    it("skips banned channels from search API results", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          channels: [
            { id: 1, slug: "banned", username: "Banned", is_banned: true },
            { id: 2, slug: "normal", username: "Normal" },
          ],
        })
      );

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await searchChannels(client, "test");

      const banned = result.data.find((c) => c.username === "banned");
      expect(banned).toBeUndefined();
    });

    it("handles search API returning data in array format", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([{ id: 1, slug: "array-channel", username: "ArrayChannel" }])
      );

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await searchChannels(client, "array");

      const found = result.data.find((c) => c.username === "array-channel");
      expect(found).toBeDefined();
    });

    it("handles search API returning data in {data: [...]} format", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 1, slug: "data-channel", username: "DataChannel" }],
        })
      );

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await searchChannels(client, "data");

      const found = result.data.find((c) => c.username === "data-channel");
      expect(found).toBeDefined();
    });

    it("returns empty results when all steps fail or find nothing", async () => {
      mockFetch.mockRejectedValueOnce(new Error("timeout"));

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await searchChannels(client, "nonexistent");

      expect(result.data).toEqual([]);
    });

    it("continues searching when a short-query endpoint fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("first endpoint failed"));
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          channels: [{ id: 1, slug: "step2-result", username: "Step2" }],
        })
      );

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await searchChannels(client, "st");

      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("search", () => {
    it("returns channels, categories, streams, videos, and clips", async () => {
      vi.mocked(searchCategories).mockResolvedValueOnce({
        data: [{ id: "1", platform: "kick", name: "Gaming", boxArtUrl: "" }],
      });

      mockFetch.mockResolvedValueOnce(jsonResponse({ channels: [] }));

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await search(client, "test");

      expect(result).toHaveProperty("channels");
      expect(result).toHaveProperty("categories");
      expect(result).toHaveProperty("streams");
      expect(result).toHaveProperty("videos");
      expect(result).toHaveProperty("clips");
      expect(result.categories).toHaveLength(1);
      expect(result.videos).toEqual([]);
      expect(result.clips).toEqual([]);
    });

    it("fetches stream info for live channels in search results", async () => {
      vi.mocked(searchCategories).mockResolvedValueOnce({ data: [] });

      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          channels: [
            {
              id: 100,
              slug: "live-search",
              username: "LiveSearch",
              isLive: true,
            },
          ],
        })
      );

      vi.mocked(getStreamBySlug).mockResolvedValueOnce({
        id: "s-100",
        platform: "kick",
        channelId: "100",
        channelName: "live-search",
        channelDisplayName: "LiveSearch",
        channelAvatar: "",
        title: "Live now!",
        viewerCount: 500,
        thumbnailUrl: "",
        isLive: true,
        startedAt: "",
        language: "en",
        tags: [],
      });

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await search(client, "live-search");

      expect(result.streams).toHaveLength(1);
      expect(result.streams[0].title).toBe("Live now!");
    });
  });
});
