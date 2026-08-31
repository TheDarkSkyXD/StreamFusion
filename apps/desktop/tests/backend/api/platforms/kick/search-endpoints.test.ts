import Module from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ *
 * Electron mock: search-endpoints.ts uses `require("electron")` (CJS)*
 * inside function bodies. vi.mock only intercepts ESM imports.        *
 * ------------------------------------------------------------------ */
const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

const _origRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === "electron") {
    return { net: { fetch: (...args: unknown[]) => mockFetch(...args) } };
  }
  return _origRequire.call(this, id);
};

vi.mock("@backend/api/platforms/kick/kick-network-health", () => ({
  acquireKickRequestSlot: vi.fn(async () => () => {}),
}));

vi.mock("@shared/utils/managed-interval", () => ({
  createManagedInterval: vi.fn(),
}));

vi.mock("@backend/api/platforms/kick/endpoints/stream-endpoints", () => ({
  getStreamBySlug: vi.fn().mockResolvedValue(null),
  getPublicTopStreams: vi.fn().mockResolvedValue({ data: [] }),
  rememberCategorySlug: vi.fn(),
}));

vi.mock("@backend/api/platforms/kick/endpoints/channel-endpoints", () => ({
  getChannel: vi.fn().mockResolvedValue(null),
  getPublicChannel: vi.fn().mockResolvedValue(null),
  acquireBrowserWindowSlot: vi.fn(async () => vi.fn()),
  mapKickChatroomToSettings: vi.fn(),
}));

vi.mock("@backend/api/platforms/kick/endpoints/category-endpoints", () => ({
  searchCategories: vi.fn().mockResolvedValue({ data: [] }),
}));

import { searchCategories } from "@backend/api/platforms/kick/endpoints/category-endpoints";
import { acquireKickRequestSlot } from "@backend/api/platforms/kick/kick-network-health";
import {
  getChannel,
  getPublicChannel,
} from "@backend/api/platforms/kick/endpoints/channel-endpoints";
import {
  resetPublicSearchCacheForTests,
  search,
  searchChannels,
} from "@backend/api/platforms/kick/endpoints/search-endpoints";
import {
  getPublicTopStreams,
  getStreamBySlug,
} from "@backend/api/platforms/kick/endpoints/stream-endpoints";
import type { KickRequestor } from "@backend/api/platforms/kick/kick-requestor";
import type { UnifiedChannel, UnifiedStream } from "@shared/platform-types";

function createMockClient(overrides: Partial<KickRequestor> = {}): KickRequestor {
  return {
    request: vi.fn(),
    isAuthenticated: vi.fn(() => true),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Guards: Kick channel search suggestions must not use the hidden BrowserWindow channel lookup path.
// Guards: Kick full search should parallelize independent category/channel/stream work where possible.
// Guards: stale full search cancellation stops queued live hydration and reaches category enumeration.
// Guards: channel suggestions skip the live-directory crawl unless empty, continued, or live-only lacks a live candidate.
// Guards: an explicit Kick search is_banned signal remains visible as a machine-readable suspended channel.
// Guards: a positively resolved Kick search account is classified active independently from live/offline state.
describe("search-endpoints", () => {
  beforeEach(() => {
    resetPublicSearchCacheForTests();
    mockFetch.mockReset();
    vi.mocked(getPublicChannel).mockReset().mockResolvedValue(null);
    vi.mocked(getChannel).mockReset().mockResolvedValue(null);
    vi.mocked(getPublicTopStreams).mockReset().mockResolvedValue({ data: [] });
    vi.mocked(getStreamBySlug).mockReset().mockResolvedValue(null);
    vi.mocked(searchCategories).mockReset().mockResolvedValue({ data: [] });
    vi.mocked(acquireKickRequestSlot)
      .mockReset()
      .mockImplementation(async () => () => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("searchChannels", () => {
    it("shares an in-flight public search across duplicate Kick lookups", async () => {
      const response = deferred<Response>();
      mockFetch.mockReturnValue(response.promise);
      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });

      const first = searchChannels(client, "streamer");
      const second = searchChannels(client, "streamer");
      await Promise.resolve();
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(1);

      response.resolve(
        jsonResponse({
          channels: [{ id: 100, slug: "streamer", username: "Streamer" }],
        })
      );
      await expect(Promise.all([first, second])).resolves.toEqual([
        expect.objectContaining({ data: [expect.objectContaining({ username: "streamer" })] }),
        expect.objectContaining({ data: [expect.objectContaining({ username: "streamer" })] }),
      ]);
    });

    it("shares the public-search cache across query casing", async () => {
      mockFetch.mockResolvedValue(
        jsonResponse({ channels: [{ id: 100, slug: "streamer", username: "Streamer" }] })
      );
      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });

      await searchChannels(client, "Streamer");
      await searchChannels(client, "streamer");

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does not retain a failed public-search payload in the cache", async () => {
      mockFetch.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });

      await searchChannels(client, "streamer");
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ channels: [{ id: 100, slug: "streamer", username: "Streamer" }] })
      );
      await searchChannels(client, "streamer");

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

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
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(getPublicTopStreams).not.toHaveBeenCalled();
    });

    it("runs every legacy public search request through the global Kick request budget", async () => {
      const releaseSlot = vi.fn();
      vi.mocked(acquireKickRequestSlot).mockResolvedValueOnce(releaseSlot);
      mockFetch.mockResolvedValueOnce(jsonResponse({ channels: [] }));

      await searchChannels(createMockClient({ isAuthenticated: vi.fn(() => false) }), "search");

      expect(acquireKickRequestSlot).toHaveBeenCalledTimes(1);
      expect(releaseSlot).toHaveBeenCalledTimes(1);
    });

    it("starts original and compact first-page searches together and merges in variant order", async () => {
      let resolveOriginal!: (response: Response) => void;
      let resolveCompact!: (response: Response) => void;
      const originalResponse = new Promise<Response>((resolve) => {
        resolveOriginal = resolve;
      });
      const compactResponse = new Promise<Response>((resolve) => {
        resolveCompact = resolve;
      });
      mockFetch
        .mockImplementationOnce(() => originalResponse)
        .mockImplementationOnce(() => compactResponse);

      const pending = searchChannels(
        createMockClient({ isAuthenticated: vi.fn(() => false) }),
        "ice poseidon"
      );
      await Promise.resolve();
      await Promise.resolve();
      const requestsStartedBeforeEitherResolved = mockFetch.mock.calls.length;

      resolveOriginal(
        jsonResponse({ channels: [{ id: 1, slug: "ice-poseidon", username: "Ice-Poseidon" }] })
      );
      resolveCompact(
        jsonResponse({ channels: [{ id: 2, slug: "iceposeidon", username: "IcePoseidon" }] })
      );
      const result = await pending;

      expect(requestsStartedBeforeEitherResolved).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
        "https://kick.com/api/search?searched_word=ice%20poseidon",
        "https://kick.com/api/search?searched_word=iceposeidon",
      ]);
      expect(result.data.map((channel) => channel.username)).toEqual([
        "ice-poseidon",
        "iceposeidon",
      ]);
    });

    it("keeps compact first-page results when the original public request fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("original failed")).mockResolvedValueOnce(
        jsonResponse({
          channels: [{ id: 2, slug: "iceposeidon", username: "IcePoseidon" }],
        })
      );

      const result = await searchChannels(
        createMockClient({ isAuthenticated: vi.fn(() => false) }),
        "ice poseidon"
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.data.map((channel) => channel.username)).toEqual(["iceposeidon"]);
    });

    it("deduplicates variant responses by slug with deterministic original-query priority", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            channels: [
              { id: 1, slug: "iceposeidon", username: "Original Format", followers_count: 10 },
            ],
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            channels: [
              { id: 2, slug: "iceposeidon", username: "Compact Format", followers_count: 20 },
            ],
          })
        );

      const result = await searchChannels(
        createMockClient({ isAuthenticated: vi.fn(() => false) }),
        "ice poseidon"
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          id: "1",
          username: "iceposeidon",
          displayName: "Original Format",
          followerCount: 10,
        })
      );
    });

    it("does not add a compact retry when the compact identity is too short", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ channels: [] }));

      await searchChannels(createMockClient({ isAuthenticated: vi.fn(() => false) }), "a b");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://kick.com/api/search?searched_word=a%20b",
        expect.any(Object)
      );
    });

    it("does not repeat public query variants on continuation pages", async () => {
      await searchChannels(
        createMockClient({ isAuthenticated: vi.fn(() => false) }),
        "ice poseidon",
        { cursor: "100" }
      );

      expect(mockFetch).not.toHaveBeenCalled();
      expect(getPublicTopStreams).toHaveBeenCalledWith({ limit: 100, cursor: "100" });
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
            language: "en",
            tags: [],
          },
        ],
      });

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await searchChannels(client, "dup-channel");

      const matches = result.data.filter((c) => c.username.toLowerCase() === "dup-channel");
      expect(matches).toHaveLength(1);
    });

    it("uses public suggestions without waiting for an avatar-only live-directory merge", async () => {
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
            language: "en",
            tags: [],
          },
        ],
      });

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await searchChannels(client, "merge-test");

      const channel = result.data.find((c) => c.username === "merge-test");
      expect(channel).toBeDefined();
      expect(channel!.avatarUrl).toBe("");
      expect(channel!.followerCount).toBe(10000);
      expect(getPublicTopStreams).not.toHaveBeenCalled();
    });

    it("falls back to the live directory when a live-only search has no live public candidate", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          channels: [{ id: 100, slug: "creator", username: "Creator", isLive: false }],
        })
      );
      vi.mocked(getPublicTopStreams).mockResolvedValueOnce({
        data: [
          {
            id: "stream-1",
            platform: "kick",
            channelId: "100",
            channelName: "creator",
            channelDisplayName: "Creator",
            channelAvatar: "https://example.com/avatar.webp",
            title: "Live",
            viewerCount: 50,
            thumbnailUrl: "",
            isLive: true,
            startedAt: "",
            language: "en",
            tags: [],
          },
        ],
      });

      const result = await searchChannels(
        createMockClient({ isAuthenticated: vi.fn(() => false) }),
        "creator",
        {
          liveOnly: true,
        }
      );

      expect(getPublicTopStreams).toHaveBeenCalledTimes(1);
      expect(result.data.find((channel) => channel.username === "creator")?.isLive).toBe(true);
    });

    it("preserves public verified metadata without a live-directory fallback", async () => {
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
            language: "en",
            tags: [],
          },
        ],
      });

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await searchChannels(client, "verified-merge");

      const channel = result.data.find((c) => c.username === "verified-merge");
      expect(channel).toBeDefined();
      expect(channel!.isVerified).toBe(true);
      expect(getPublicTopStreams).not.toHaveBeenCalled();
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
            language: "en",
            tags: [],
          },
        ],
      });

      mockFetch.mockResolvedValueOnce(jsonResponse({ channels: [] }));

      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      const result = await searchChannels(client, "fuzzy");

      const found = result.data.find((c) => c.username === "fuzzy-match");
      expect(found).toBeDefined();
      expect(found!.isLive).toBe(true);
      expect(found!.accountStatus).toBe("active");
    });

    it("matches compact live-directory identities for separated queries", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ channels: [] }))
        .mockResolvedValueOnce(jsonResponse({ channels: [] }));
      vi.mocked(getPublicTopStreams).mockResolvedValueOnce({
        data: [
          {
            id: "s1",
            platform: "kick",
            channelId: "300",
            channelName: "iceposeidon",
            channelDisplayName: "IcePoseidon",
            channelAvatar: "https://example.com/ice.webp",
            title: "Playing",
            viewerCount: 1000,
            thumbnailUrl: "",
            isLive: true,
            startedAt: "",
            language: "en",
            tags: [],
          },
        ],
      });

      const result = await searchChannels(
        createMockClient({ isAuthenticated: vi.fn(() => false) }),
        "ice poseidon"
      );

      expect(result.data.map((channel) => channel.username)).toEqual(["iceposeidon"]);
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
              language: "en",
              tags: [],
            },
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
              language: "en",
              tags: [],
            },
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
              language: "en",
              tags: [],
            },
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

    it("classifies an explicitly banned public-search account as suspended", async () => {
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
      expect(banned).toEqual(
        expect.objectContaining({
          displayName: "Banned",
          accountStatus: "suspended",
        })
      );
    });

    it("preserves explicit suspension while merging official profile metadata", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          channels: [
            {
              id: 1,
              slug: "banned-with-profile",
              username: "BannedWithProfile",
              is_banned: true,
            },
          ],
        })
      );
      vi.mocked(getChannel).mockResolvedValueOnce({
        id: "1",
        platform: "kick",
        username: "banned-with-profile",
        displayName: "BannedWithProfile",
        avatarUrl: "https://example.com/banned-with-profile.webp",
        isLive: false,
        isVerified: false,
        isPartner: false,
      });

      const result = await searchChannels(createMockClient(), "banned-with-profile");

      expect(result.data).toEqual([
        expect.objectContaining({
          username: "banned-with-profile",
          avatarUrl: "https://example.com/banned-with-profile.webp",
          accountStatus: "suspended",
        }),
      ]);
    });

    it("classifies a positively resolved offline public-search account as active", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          channels: [{ id: 2, slug: "offline-channel", username: "OfflineChannel", isLive: false }],
        })
      );

      const result = await searchChannels(
        createMockClient({ isAuthenticated: vi.fn(() => false) }),
        "offline-channel"
      );

      expect(result.data).toEqual([
        expect.objectContaining({
          username: "offline-channel",
          isLive: false,
          accountStatus: "active",
        }),
      ]);
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
    it("stops queued live hydration after cancellation and forwards the signal to categories", async () => {
      const controller = new AbortController();
      const firstStream = deferred<UnifiedStream | null>();
      vi.mocked(getStreamBySlug).mockImplementationOnce(() => firstStream.promise);
      const seeds: UnifiedChannel[] = [
        {
          id: "1",
          platform: "kick",
          username: "one",
          displayName: "One",
          avatarUrl: "",
          isLive: true,
          isVerified: false,
          isPartner: false,
        },
        {
          id: "2",
          platform: "kick",
          username: "two",
          displayName: "Two",
          avatarUrl: "",
          isLive: true,
          isVerified: false,
          isPartner: false,
        },
      ];

      const pending = search(createMockClient(), "live", {
        channelSeeds: seeds,
        signal: controller.signal,
      });
      await vi.waitFor(() => expect(getStreamBySlug).toHaveBeenCalledTimes(1));
      controller.abort();
      firstStream.resolve(null);
      await pending;

      expect(searchCategories).toHaveBeenCalledWith(
        expect.anything(),
        "live",
        expect.objectContaining({ signal: controller.signal })
      );
      expect(getStreamBySlug).toHaveBeenCalledTimes(1);
    });

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
