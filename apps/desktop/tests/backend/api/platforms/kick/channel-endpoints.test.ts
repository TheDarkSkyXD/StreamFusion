import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/api/unified/platform-health", () => ({
  isPlatformHealthy: vi.fn(() => true),
}));

vi.mock("@/lib/managed-interval", () => ({
  createManagedInterval: vi.fn(),
}));

const mockLoadURL = vi.fn();
const mockExecuteJavaScript = vi.fn();
const mockDestroy = vi.fn();
let mockTitle = "";

vi.mock("electron", () => ({
  BrowserWindow: function BrowserWindow() {
    return {
      loadURL: (...args: unknown[]) => mockLoadURL(...args),
      webContents: { executeJavaScript: (...args: unknown[]) => mockExecuteJavaScript(...args) },
      destroy: () => mockDestroy(),
      isDestroyed: () => false,
      get title() { return mockTitle; },
    };
  },
}));

import { isPlatformHealthy } from "@/backend/api/unified/platform-health";
import type { KickRequestor } from "@/backend/api/platforms/kick/kick-requestor";
import {
  mapKickChatroomToSettings,
  getChannel,
  getChannelsBySlugs,
  getPublicChannel,
  acquireBrowserWindowSlot,
} from "@/backend/api/platforms/kick/endpoints/channel-endpoints";

function createMockClient(overrides: Partial<KickRequestor> = {}): KickRequestor {
  return {
    request: vi.fn(),
    isAuthenticated: vi.fn(() => true),
    baseUrl: "https://test.example.com",
    ...overrides,
  };
}

describe("channel-endpoints", () => {
  beforeEach(() => {
    mockLoadURL.mockReset().mockResolvedValue(undefined);
    mockExecuteJavaScript.mockReset();
    mockDestroy.mockReset();
    mockTitle = "";
    vi.mocked(isPlatformHealthy).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("mapKickChatroomToSettings", () => {
    it("is re-exported from channel-endpoints (tested in chatroom-settings-mapper.test.ts)", () => {
      expect(typeof mapKickChatroomToSettings).toBe("function");
    });
  });

  describe("acquireBrowserWindowSlot", () => {
    it("returns a release function", async () => {
      const release = await acquireBrowserWindowSlot();
      expect(typeof release).toBe("function");
      release();
    });

    it("serialises concurrent calls", async () => {
      const order: number[] = [];

      const r1 = await acquireBrowserWindowSlot();
      order.push(1);

      const p2 = acquireBrowserWindowSlot().then((r) => {
        order.push(2);
        return r;
      });

      await Promise.resolve();
      expect(order).toEqual([1]);

      r1();
      const r2 = await p2;
      expect(order).toEqual([1, 2]);
      r2();
    });
  });

  describe("getPublicChannel", () => {
    it("returns null when network is likely down", async () => {
      vi.mocked(isPlatformHealthy).mockReturnValue(false);

      const result = await getPublicChannel("test-slug");

      expect(result).toBeNull();
    });

    it("returns a UnifiedChannel from a well-formed v2 response", async () => {
      const channelData = {
        id: 12345,
        user_id: 67890,
        slug: "streamer",
        user: {
          username: "Streamer",
          profile_pic: "https://files.kick.com/avatar.webp",
          bio: "Hello world",
        },
        livestream: null,
        verified: {},
        followers_count: 5000,
        chatroom: {
          id: 999,
          followers_mode: false,
          subscribers_mode: false,
          emotes_mode: false,
          slow_mode: false,
        },
      };

      mockExecuteJavaScript.mockResolvedValueOnce(JSON.stringify(channelData));

      const result = await getPublicChannel("streamer");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("12345");
      expect(result!.platform).toBe("kick");
      expect(result!.username).toBe("streamer");
      expect(result!.displayName).toBe("Streamer");
      expect(result!.avatarUrl).toBe("https://files.kick.com/avatar.webp");
      expect(result!.isLive).toBe(false);
      expect(result!.followerCount).toBe(5000);
      expect(result!.chatroomId).toBe(999);
    });

    it("uses data.id (channel id) not data.user_id for UnifiedChannel.id", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({ id: 111, user_id: 222, slug: "dual-id", user: { username: "DualId" } })
      );

      const result = await getPublicChannel("dual-id");

      expect(result!.id).toBe("111");
    });

    it("preserves kickUserId separately from channel id", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({ id: 111, user_id: 222, slug: "separate-ids", user: { username: "Sep" } })
      );

      const result = await getPublicChannel("separate-ids");

      expect(result!.id).toBe("111");
      expect(result!.kickUserId).toBe("222");
    });

    it("detects live streams from non-null livestream field", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 100,
          slug: "live-streamer",
          user: { username: "LiveStreamer" },
          livestream: { session_title: "Live now", categories: [{ id: 1, name: "Gaming" }] },
        })
      );

      const result = await getPublicChannel("live-streamer");

      expect(result!.isLive).toBe(true);
      expect(result!.categoryId).toBe("1");
      expect(result!.categoryName).toBe("Gaming");
      expect(result!.lastStreamTitle).toBe("Live now");
    });

    it("returns null for 'Not found' response", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({ message: "Not found", code: 404 })
      );

      const result = await getPublicChannel("nonexistent");

      expect(result).toBeNull();
    });

    it("returns null when response is empty", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce("");

      const result = await getPublicChannel("empty-response");

      expect(result).toBeNull();
    });

    it("returns null when response is not valid JSON and title is Cloudflare", async () => {
      mockTitle = "Just a moment...";
      mockExecuteJavaScript.mockResolvedValueOnce("<html>Cloudflare challenge</html>");

      const result = await getPublicChannel("cf-challenge");

      expect(result).toBeNull();
    });

    it("returns null when userId is missing", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({ slug: "no-id", user: { username: "NoId" } })
      );

      const result = await getPublicChannel("no-id");

      expect(result).toBeNull();
    });

    it("returns null on server error text in body", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce("Internal Server Error");

      const result = await getPublicChannel("server-error");

      expect(result).toBeNull();
    });

    it("extracts banner from offline_banner_image srcset", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 1,
          slug: "banner-test",
          user: { username: "BannerTest" },
          offline_banner_image: {
            srcset: "https://files.kick.com/banner-1200w.webp 1200w, https://files.kick.com/banner-600w.webp 600w",
          },
        })
      );

      const result = await getPublicChannel("banner-test");

      expect(result!.bannerUrl).toBe("https://files.kick.com/banner-1200w.webp");
    });

    it("falls back to offline_banner_image.src when srcset is absent", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 1,
          slug: "banner-src-test",
          user: { username: "BannerSrc" },
          offline_banner_image: { src: "https://files.kick.com/banner.jpg" },
        })
      );

      const result = await getPublicChannel("banner-src-test");

      expect(result!.bannerUrl).toBe("https://files.kick.com/banner.jpg");
    });

    it("extracts category from recent_categories when livestream is null", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 1,
          slug: "cat-test",
          user: { username: "CatTest" },
          livestream: null,
          recent_categories: [{ id: 42, name: "Slots" }],
        })
      );

      const result = await getPublicChannel("cat-test");

      expect(result!.categoryId).toBe("42");
      expect(result!.categoryName).toBe("Slots");
    });

    it("extracts lastStreamTitle from previous_livestreams when not live", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 1,
          slug: "prev-title",
          user: { username: "PrevTitle" },
          livestream: null,
          previous_livestreams: [{ session_title: "Yesterday's stream" }],
        })
      );

      const result = await getPublicChannel("prev-title");

      expect(result!.lastStreamTitle).toBe("Yesterday's stream");
    });

    it("destroys the BrowserWindow after use", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({ id: 1, slug: "cleanup", user: { username: "Cleanup" } })
      );

      await getPublicChannel("cleanup");

      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  describe("getChannelsBySlugs", () => {
    it("returns empty array for empty slugs input", async () => {
      const client = createMockClient();

      const result = await getChannelsBySlugs(client, []);

      expect(result).toEqual([]);
      expect(client.request).not.toHaveBeenCalled();
    });

    it("constructs correct query params for multiple slugs", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            { broadcaster_user_id: 1, slug: "a", channel_description: "", stream: null, stream_title: "", banner_picture: null, category: null },
            { broadcaster_user_id: 2, slug: "b", channel_description: "", stream: null, stream_title: "", banner_picture: null, category: null },
          ],
        }),
      });

      const result = await getChannelsBySlugs(client, ["a", "b"]);

      expect(client.request).toHaveBeenCalledWith(
        expect.stringContaining("slug[]=a&slug[]=b")
      );
      expect(result).toHaveLength(2);
    });

    it("limits slugs to 50", async () => {
      const slugs = Array.from({ length: 60 }, (_, i) => `slug-${i}`);
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({ data: [] }),
      });

      await getChannelsBySlugs(client, slugs);

      const calledWith = vi.mocked(client.request).mock.calls[0][0] as string;
      const slugCount = (calledWith.match(/slug\[\]/g) || []).length;
      expect(slugCount).toBe(50);
    });

    it("returns empty array on request failure", async () => {
      const client = createMockClient({
        request: vi.fn().mockRejectedValueOnce(new Error("500")),
      });

      const result = await getChannelsBySlugs(client, ["fail"]);

      expect(result).toEqual([]);
    });

    it("returns empty array when response.data is null", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({ data: null }),
      });

      const result = await getChannelsBySlugs(client, ["null-data"]);

      expect(result).toEqual([]);
    });
  });

  describe("getChannel", () => {
    it("prefers public API result over authenticated API", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 100,
          slug: "public-first",
          user: { username: "PublicFirst", profile_pic: "https://example.com/avatar.webp" },
        })
      );

      const client = createMockClient();
      const result = await getChannel(client, "public-first");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("100");
      expect(client.request).not.toHaveBeenCalled();
    });

    it("falls back to authenticated API when public fails", async () => {
      mockLoadURL.mockRejectedValueOnce(new Error("timeout"));

      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [{
            broadcaster_user_id: 200,
            slug: "auth-fallback",
            channel_description: "desc",
            stream_title: "title",
            banner_picture: null,
            category: null,
            stream: null,
          }],
        }),
      });

      vi.mock("@/backend/api/platforms/kick/endpoints/user-endpoints", async () => {
        const actual = await vi.importActual<typeof import("@/backend/api/platforms/kick/endpoints/user-endpoints")>("@/backend/api/platforms/kick/endpoints/user-endpoints");
        return {
          ...actual,
          getUsersById: vi.fn().mockResolvedValue([]),
        };
      });

      const result = await getChannel(client, "auth-fallback");

      expect(result).not.toBeNull();
    });

    it("returns null when both APIs fail", async () => {
      mockLoadURL.mockRejectedValueOnce(new Error("timeout"));

      const client = createMockClient({
        isAuthenticated: vi.fn(() => false),
      });

      const result = await getChannel(client, "both-fail");

      expect(result).toBeNull();
    });

    it("normalizes slug to lowercase for cache", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 1,
          slug: "CaseSensitive",
          user: { username: "CaseSensitive" },
        })
      );

      await getChannel(createMockClient(), "CaseSensitive");

      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 1,
          slug: "casesensitive",
          user: { username: "casesensitive" },
        })
      );

      const second = await getChannel(createMockClient(), "casesensitive");

      expect(second).not.toBeNull();
    });
  });
});
