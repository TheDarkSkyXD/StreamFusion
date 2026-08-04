import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/api/unified/platform-health", () => ({
  getPlatformHealth: vi.fn(() => "healthy"),
  isPlatformHealthy: vi.fn(() => true),
}));

vi.mock("@/lib/managed-interval", () => ({
  createManagedInterval: vi.fn(),
}));

const { getUsersByIdMock, getLatestCompletedVideoEndedAtMock } = vi.hoisted(() => ({
  getUsersByIdMock: vi.fn(),
  getLatestCompletedVideoEndedAtMock: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/user-endpoints", async () => {
  const actual = await vi.importActual<
    typeof import("@/backend/api/platforms/kick/endpoints/user-endpoints")
  >("@/backend/api/platforms/kick/endpoints/user-endpoints");
  return {
    ...actual,
    getUsersById: getUsersByIdMock,
  };
});

vi.mock("@/backend/api/platforms/kick/endpoints/video-endpoints", () => ({
  getLatestCompletedVideoEndedAtByChannelSlug: getLatestCompletedVideoEndedAtMock,
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
      get title() {
        return mockTitle;
      },
    };
  },
}));

import {
  acquireBrowserWindowSlot,
  getChannel,
  getChannelsByBroadcasterIds,
  getChannelsBySlugs,
  getOfficialKickChannelAccountStatus,
  getPublicChannel,
  mapKickChatroomToSettings,
} from "@/backend/api/platforms/kick/endpoints/channel-endpoints";
import type { KickRequestor } from "@/backend/api/platforms/kick/kick-requestor";
import { getPlatformHealth, isPlatformHealthy } from "@/backend/api/unified/platform-health";

function createMockClient(overrides: Partial<KickRequestor> = {}): KickRequestor {
  return {
    request: vi.fn(),
    isAuthenticated: vi.fn(() => true),
    baseUrl: "https://test.example.com",
    ...overrides,
  };
}

// Guards: public Kick channel lookup never presents a prior livestream start as its end time.
// Guards: normal Kick channel lookup keeps official identity while preserving richer offline profile metadata from the legacy response.
// Guards: official offline channel detail preserves the public profile avatar when user enrichment is unavailable.
// Guards: only an explicit official Kick 404 or Not found response authorizes account removal.
describe("channel-endpoints", () => {
  beforeEach(() => {
    mockLoadURL.mockReset().mockResolvedValue(undefined);
    mockExecuteJavaScript.mockReset();
    mockDestroy.mockReset();
    mockTitle = "";
    vi.mocked(getPlatformHealth).mockReturnValue("healthy");
    vi.mocked(isPlatformHealthy).mockReturnValue(true);
    getUsersByIdMock.mockReset().mockResolvedValue([]);
    getLatestCompletedVideoEndedAtMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("mapKickChatroomToSettings", () => {
    it("is re-exported from channel-endpoints (tested in chatroom-settings-mapper.test.ts)", () => {
      expect(typeof mapKickChatroomToSettings).toBe("function");
    });
  });

  describe("getOfficialKickChannelAccountStatus", () => {
    it("classifies an explicit provider 404 as not_found", async () => {
      const client = createMockClient({
        request: vi.fn().mockRejectedValue(new Error("Kick API error: 404")),
      });

      await expect(getOfficialKickChannelAccountStatus(client, "deleted-channel")).resolves.toBe(
        "not_found"
      );
    });

    it("classifies an exact successful provider row as active", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValue({
          data: [{ broadcaster_user_id: 123, slug: "active-offline", stream: null }],
        }),
      });

      await expect(getOfficialKickChannelAccountStatus(client, "Active-Offline")).resolves.toBe(
        "active"
      );
    });

    it.each([
      ["timeout", vi.fn().mockRejectedValue(new Error("request timed out"))],
      ["rate limit", vi.fn().mockRejectedValue({ response: { status: 429 } })],
      ["auth failure", vi.fn().mockRejectedValue({ status: 401 })],
      ["provider outage", vi.fn().mockRejectedValue(new Error("Kick API error: 503"))],
      ["malformed response", vi.fn().mockResolvedValue({ data: {} })],
      ["missing result", vi.fn().mockResolvedValue({ data: [] })],
      [
        "ambiguous mismatched result",
        vi.fn().mockResolvedValue({ data: [{ broadcaster_user_id: 999, slug: "someone-else" }] }),
      ],
    ])("classifies %s as unavailable", async (_caseName, request) => {
      const client = createMockClient({ request });

      await expect(getOfficialKickChannelAccountStatus(client, "uncertain-channel")).resolves.toBe(
        "unavailable"
      );
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
    it("returns null when network is down", async () => {
      vi.mocked(getPlatformHealth).mockReturnValue("down");

      const result = await getPublicChannel("test-slug");

      expect(result).toBeNull();
      expect(mockLoadURL).not.toHaveBeenCalled();
    });

    it("still attempts public channel lookup when platform is degraded", async () => {
      vi.mocked(getPlatformHealth).mockReturnValue("degraded");
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({ id: 12345, slug: "degraded-slug", user: { username: "Degraded" } })
      );

      const result = await getPublicChannel("degraded-slug");

      expect(result).not.toBeNull();
      expect(mockLoadURL).toHaveBeenCalled();
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
        followers_count: "5000",
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

    it("reads avatar from profile_picture when the v2 user block uses official-style naming", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 12345,
          user_id: 67890,
          slug: "profile-picture",
          user: {
            username: "ProfilePicture",
            profile_picture: "https://kick.com/img/avatar.webp",
          },
          livestream: null,
        })
      );

      const result = await getPublicChannel("profile-picture");

      expect(result!.avatarUrl).toBe("https://kick.com/img/avatar.webp");
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
            srcset:
              "https://files.kick.com/banner-1200w.webp 1200w, https://files.kick.com/banner-600w.webp 600w",
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

    it("does not expose a previous livestream start as its last-live time", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 1,
          slug: "previous-live-time",
          user: { username: "PreviousLiveTime" },
          livestream: null,
          previous_livestreams: [
            { created_at: "2026-08-01T15:30:00Z", session_title: "Previous stream" },
          ],
        })
      );

      const result = await getPublicChannel("previous-live-time");

      expect(result!.lastLiveAt).toBeUndefined();
    });

    it("ignores a blank previous livestream creation time", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 1,
          slug: "blank-live-time",
          user: { username: "BlankLiveTime" },
          livestream: null,
          previous_livestreams: [{ created_at: "   " }],
        })
      );

      const result = await getPublicChannel("blank-live-time");

      expect(result!.lastLiveAt).toBeUndefined();
    });

    it("destroys the BrowserWindow after use", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({ id: 1, slug: "cleanup", user: { username: "Cleanup" } })
      );

      await getPublicChannel("cleanup");

      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  // Guards: Kick slug filters use OpenAPI collectionFormat multi instead of ignored bracket-suffixed parameters.
  // Guards: an ignored Kick slug filter cannot substitute the signed-in user's channel into search results.
  // Guards: slug-batched Kick channels use profile metadata for display casing while preserving normalized usernames.
  describe("getChannelsBySlugs", () => {
    it("returns empty array for empty slugs input", async () => {
      const client = createMockClient();

      const result = await getChannelsBySlugs(client, []);

      expect(result).toEqual([]);
      expect(client.request).not.toHaveBeenCalled();
    });

    it("skips official slug batch lookup while Kick official API is degraded", async () => {
      vi.mocked(getPlatformHealth).mockReturnValue("degraded");
      const client = createMockClient();

      const result = await getChannelsBySlugs(client, ["a", "b"]);

      expect(result).toEqual([]);
      expect(client.request).not.toHaveBeenCalled();
    });

    it("serializes slugs using the official repeated query parameter", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            {
              broadcaster_user_id: 1,
              slug: "a",
              channel_description: "",
              stream: null,
              stream_title: "",
              banner_picture: null,
              category: null,
            },
            {
              broadcaster_user_id: 2,
              slug: "b",
              channel_description: "",
              stream: null,
              stream_title: "",
              banner_picture: null,
              category: null,
            },
          ],
        }),
      });

      const result = await getChannelsBySlugs(client, ["a", "b"]);

      expect(client.request).toHaveBeenCalledWith("/channels?slug=a&slug=b", undefined, "app");
      expect(result).toHaveLength(2);
    });

    it("returns the cased display name from Kick user metadata", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            {
              broadcaster_user_id: 123,
              slug: "nickwhite",
              channel_description: "",
              stream: null,
              stream_title: "",
              banner_picture: null,
              category: null,
            },
          ],
        }),
      });
      getUsersByIdMock.mockResolvedValueOnce([
        {
          user_id: 123,
          name: "NickWhite",
          profile_picture: "https://kick.com/img/nickwhite.webp",
        },
      ]);

      const result = await getChannelsBySlugs(client, ["nickwhite"]);

      expect(result[0]).toMatchObject({
        username: "nickwhite",
        displayName: "NickWhite",
      });
    });

    it("rejects channels whose slug was not requested", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            {
              broadcaster_user_id: 999,
              slug: "signed-in-user",
              channel_description: "",
              stream: null,
              stream_title: "",
              banner_picture: null,
              category: null,
            },
          ],
        }),
      });

      const result = await getChannelsBySlugs(client, ["requested-slug"]);

      expect(result).toEqual([]);
    });

    it("limits slugs to 50", async () => {
      const slugs = Array.from({ length: 60 }, (_, i) => `slug-${i}`);
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({ data: [] }),
      });

      await getChannelsBySlugs(client, slugs);

      const calledWith = vi.mocked(client.request).mock.calls[0][0] as string;
      const slugCount = (calledWith.match(/[?&]slug=/g) || []).length;
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

  // Guards: signed-in Kick follow slug repair uses user-token channel reads so a broken app-token proxy does not spam 401s during follow hydration.
  // Guards: guest Kick follow slug repair still uses the worker-backed app token because no user token is available.
  // Guards: Kick broadcaster filters use OpenAPI collectionFormat multi instead of ignored bracket-suffixed parameters.
  // Guards: an ignored Kick broadcaster filter cannot substitute the signed-in user's channel during username repair.
  // Guards: followed-channel refresh preserves Kick's cased profile name instead of replacing it with the lowercase slug.
  describe("getChannelsByBroadcasterIds", () => {
    it("returns empty array for empty broadcaster ID input", async () => {
      const client = createMockClient();

      const result = await getChannelsByBroadcasterIds(client, []);

      expect(result).toEqual([]);
      expect(client.request).not.toHaveBeenCalled();
    });

    it("skips official broadcaster ID lookup while Kick official API is degraded", async () => {
      vi.mocked(getPlatformHealth).mockReturnValue("degraded");
      const client = createMockClient();

      const result = await getChannelsByBroadcasterIds(client, [123, 456]);

      expect(result).toEqual([]);
      expect(client.request).not.toHaveBeenCalled();
    });

    it("serializes broadcaster IDs using the official repeated query parameter", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            {
              broadcaster_user_id: 123,
              slug: "new-slug",
              channel_description: "",
              stream: null,
              stream_title: "",
              banner_picture: null,
              category: null,
            },
            {
              broadcaster_user_id: 456,
              slug: "other-slug",
              channel_description: "",
              stream: null,
              stream_title: "",
              banner_picture: null,
              category: null,
            },
          ],
        }),
      });

      const result = await getChannelsByBroadcasterIds(client, [123, 456]);

      expect(client.request).toHaveBeenCalledWith(
        "/channels?broadcaster_user_id=123&broadcaster_user_id=456",
        undefined,
        "user"
      );
      expect(result.map((channel) => channel.username)).toEqual(["new-slug", "other-slug"]);
    });

    it("returns the cased display name from Kick user metadata", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            {
              broadcaster_user_id: 123,
              slug: "abbyapple",
              channel_description: "",
              stream: null,
              stream_title: "",
              banner_picture: null,
              category: null,
            },
          ],
        }),
      });
      getUsersByIdMock.mockResolvedValueOnce([
        {
          user_id: 123,
          name: "AbbyApple",
          profile_picture: "https://kick.com/img/abbyapple.webp",
        },
      ]);

      const result = await getChannelsByBroadcasterIds(client, [123]);

      expect(result[0]).toMatchObject({
        username: "abbyapple",
        displayName: "AbbyApple",
      });
    });

    it("rejects channels whose broadcaster ID was not requested", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            {
              broadcaster_user_id: 999,
              slug: "signed-in-user",
              channel_description: "",
              stream: null,
              stream_title: "",
              banner_picture: null,
              category: null,
            },
          ],
        }),
      });

      const result = await getChannelsByBroadcasterIds(client, [123]);

      expect(result).toEqual([]);
    });

    it("uses app auth for broadcaster ID repair when no Kick user token is available", async () => {
      const client = createMockClient({
        isAuthenticated: vi.fn(() => false),
        request: vi.fn().mockResolvedValueOnce({
          data: [
            {
              broadcaster_user_id: 123,
              slug: "guest-repair",
              channel_description: "",
              stream: null,
              stream_title: "",
              banner_picture: null,
              category: null,
            },
          ],
        }),
      });

      const result = await getChannelsByBroadcasterIds(client, [123]);

      expect(client.request).toHaveBeenCalledWith(
        expect.stringContaining("broadcaster_user_id=123"),
        undefined,
        "app"
      );
      expect(result.map((channel) => channel.username)).toEqual(["guest-repair"]);
    });

    it("falls back to app auth if a signed-in user's channel read is rejected", async () => {
      const client = createMockClient({
        request: vi
          .fn()
          .mockRejectedValueOnce(new Error("Kick API error: 401"))
          .mockResolvedValueOnce({
            data: [
              {
                broadcaster_user_id: 123,
                slug: "fallback-repair",
                channel_description: "",
                stream: null,
                stream_title: "",
                banner_picture: null,
                category: null,
              },
            ],
          }),
      });

      const result = await getChannelsByBroadcasterIds(client, [123]);

      expect(vi.mocked(client.request).mock.calls.map((call) => call[2])).toEqual(["user", "app"]);
      expect(result.map((channel) => channel.username)).toEqual(["fallback-repair"]);
    });

    it("does not retry app auth after a non-auth user-token failure", async () => {
      const client = createMockClient({
        request: vi.fn().mockRejectedValueOnce(new Error("Kick API error: 500")),
      });

      const result = await getChannelsByBroadcasterIds(client, [123]);

      expect(client.request).toHaveBeenCalledTimes(1);
      expect(vi.mocked(client.request).mock.calls[0][2]).toBe("user");
      expect(result).toEqual([]);
    });

    it("chunks broadcaster IDs into 50-item requests without dropping later follows", async () => {
      const ids = Array.from({ length: 60 }, (_, i) => i + 1);
      const client = createMockClient({
        request: vi
          .fn()
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValueOnce({
            data: [
              {
                broadcaster_user_id: 60,
                slug: "renamed-after-first-page",
                channel_description: "",
                stream: null,
                stream_title: "",
                banner_picture: null,
                category: null,
              },
            ],
          }),
      });

      const result = await getChannelsByBroadcasterIds(client, ids);

      const calls = vi.mocked(client.request).mock.calls.map((call) => call[0] as string);
      expect(calls).toHaveLength(2);
      expect((calls[0].match(/[?&]broadcaster_user_id=/g) || []).length).toBe(50);
      expect((calls[1].match(/[?&]broadcaster_user_id=/g) || []).length).toBe(10);
      expect(calls[1]).toContain("broadcaster_user_id=60");
      expect(vi.mocked(client.request).mock.calls.every((call) => call[2] === "user")).toBe(true);
      expect(result.map((channel) => channel.username)).toEqual(["renamed-after-first-page"]);
    });

    it("returns empty array on request failure", async () => {
      const client = createMockClient({
        request: vi.fn().mockRejectedValueOnce(new Error("500")),
      });

      const result = await getChannelsByBroadcasterIds(client, [123]);

      expect(result).toEqual([]);
    });
  });

  describe("getChannel", () => {
    it("hydrates chatroom metadata for a live channel returned by the official API", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            {
              broadcaster_user_id: 904,
              slug: "live-chatroom",
              channel_description: "Official description",
              stream: {
                is_live: true,
                viewer_count: 123,
                start_time: "2026-08-02T18:00:00Z",
              },
              stream_title: "Live now",
              banner_picture: null,
              category: null,
            },
          ],
        }),
      });
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 7004,
          user_id: 904,
          slug: "live-chatroom",
          user: { username: "LiveChatroom" },
          livestream: { session_title: "Live now" },
          chatroom: {
            id: 9904,
            followers_mode: false,
            subscribers_mode: false,
            emotes_mode: false,
            slow_mode: false,
          },
        })
      );

      const result = await getChannel(client, "live-chatroom");

      expect(result).toMatchObject({
        id: "904",
        username: "live-chatroom",
        displayName: "LiveChatroom",
        isLive: true,
        chatroomId: 9904,
      });
      expect(mockLoadURL).toHaveBeenCalled();
    });

    it("preserves the public avatar without official user enrichment for an anonymous degraded session", async () => {
      vi.mocked(getPlatformHealth).mockReturnValue("degraded");
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 321,
          slug: "degraded-channel",
          user: {
            username: "DegradedChannel",
            profile_pic: "https://kick.com/img/degraded-channel.webp",
          },
          livestream: null,
        })
      );
      const client = createMockClient({
        isAuthenticated: vi.fn(() => false),
        request: vi.fn().mockRejectedValueOnce(new Error("Kick API error: 401")),
      });

      const result = await getChannel(client, "degraded-channel");

      expect(client.request).not.toHaveBeenCalled();
      expect(getUsersByIdMock).not.toHaveBeenCalled();
      expect(mockLoadURL).toHaveBeenCalled();
      expect(result!.username).toBe("degraded-channel");
      expect(result!.avatarUrl).toBe("https://kick.com/img/degraded-channel.webp");
    });

    it("uses official user enrichment for an authenticated degraded session", async () => {
      vi.mocked(getPlatformHealth).mockReturnValue("degraded");
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 654,
          user_id: 987,
          slug: "authenticated-degraded",
          user: { username: "authenticated-degraded" },
          livestream: null,
        })
      );
      const client = createMockClient({
        isAuthenticated: vi.fn(() => true),
      });
      getUsersByIdMock.mockResolvedValueOnce([
        {
          user_id: 987,
          name: "AuthenticatedDegraded",
          profile_picture: "https://kick.com/img/authenticated-degraded.webp",
        },
      ]);

      const result = await getChannel(client, "authenticated-degraded");

      expect(getUsersByIdMock).toHaveBeenCalledWith(client, [987]);
      expect(result!.avatarUrl).toBe("https://kick.com/img/authenticated-degraded.webp");
    });

    it("adds the latest completed VOD time to an offline public fallback channel", async () => {
      vi.mocked(getPlatformHealth).mockReturnValue("degraded");
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 655,
          user_id: 988,
          slug: "public-vod-time-fallback",
          user: { username: "Public VOD Time Fallback" },
          livestream: null,
          followers_count: "12500",
        })
      );
      getLatestCompletedVideoEndedAtMock.mockResolvedValueOnce("2026-08-01T12:00:00Z");
      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });

      const result = await getChannel(client, "public-vod-time-fallback");

      expect(result).toMatchObject({
        username: "public-vod-time-fallback",
        followerCount: 12_500,
        lastLiveAt: "2026-08-01T12:00:00Z",
      });
      expect(getLatestCompletedVideoEndedAtMock).toHaveBeenCalledWith("public-vod-time-fallback");
    });

    it("keeps the official channel when legacy offline metadata is unavailable", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            {
              broadcaster_user_id: 100,
              slug: "official-first",
              channel_description: "",
              stream: null,
              stream_title: "",
              banner_picture: null,
              category: null,
            },
          ],
        }),
      });
      mockExecuteJavaScript.mockResolvedValueOnce("");

      const result = await getChannel(client, "official-first");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("100");
      expect(client.request).toHaveBeenCalledWith(
        "/channels?slug=official-first",
        undefined,
        "app"
      );
      expect(mockLoadURL).toHaveBeenCalled();
    });

    it("preserves the public display name when enriching an official offline channel", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            {
              broadcaster_user_id: 901,
              slug: "official-enriched",
              channel_description: "Official description",
              stream: null,
              stream_title: "Official title",
              banner_picture: null,
              category: null,
            },
          ],
        }),
      });
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 777,
          user_id: 901,
          slug: "official-enriched",
          user: { username: "Legacy Display Name", bio: "Legacy description" },
          livestream: null,
          followers_count: 196_800,
          previous_livestreams: [{ created_at: "2026-08-01T15:30:00Z" }],
        })
      );
      getLatestCompletedVideoEndedAtMock.mockResolvedValueOnce("2026-08-01T17:30:00Z");

      const result = await getChannel(client, "official-enriched");

      expect(result).toMatchObject({
        id: "901",
        kickUserId: "901",
        username: "official-enriched",
        displayName: "Legacy Display Name",
        bio: "Official description",
        isLive: false,
        followerCount: 196_800,
        lastLiveAt: "2026-08-01T17:30:00Z",
      });
      expect(mockLoadURL).toHaveBeenCalled();
      expect(getLatestCompletedVideoEndedAtMock).toHaveBeenCalledWith("official-enriched");
    });

    it("preserves the public avatar when enriching an official offline channel", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            {
              broadcaster_user_id: 903,
              slug: "public-avatar-fallback",
              channel_description: "Official description",
              stream: null,
              stream_title: "Official title",
              banner_picture: null,
              category: null,
            },
          ],
        }),
      });
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 778,
          user_id: 903,
          slug: "public-avatar-fallback",
          user: {
            username: "PublicAvatarFallback",
            profile_pic: "https://kick.com/img/public-avatar-fallback.webp",
          },
          livestream: null,
        })
      );

      const result = await getChannel(client, "public-avatar-fallback");

      expect(result!.avatarUrl).toBe("https://kick.com/img/public-avatar-fallback.webp");
    });

    it("falls back to the latest completed VOD when channel history omits last-live time", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            {
              broadcaster_user_id: 902,
              slug: "vod-time-fallback",
              channel_description: "Official description",
              stream: null,
              stream_title: "Official title",
              banner_picture: null,
              category: null,
            },
          ],
        }),
      });
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 778,
          user_id: 902,
          slug: "vod-time-fallback",
          user: { username: "VOD Time Fallback" },
          livestream: null,
          followers_count: 2_100_000,
        })
      );
      getLatestCompletedVideoEndedAtMock.mockResolvedValueOnce("2026-08-01T12:00:00Z");

      const result = await getChannel(client, "vod-time-fallback");

      expect(result).toMatchObject({
        id: "902",
        username: "vod-time-fallback",
        followerCount: 2_100_000,
        lastLiveAt: "2026-08-01T12:00:00Z",
      });
      expect(getLatestCompletedVideoEndedAtMock).toHaveBeenCalledWith("vod-time-fallback");
    });

    it("uses official app-token API without requiring a viewer login", async () => {
      const client = createMockClient({
        isAuthenticated: vi.fn(() => false),
        request: vi.fn().mockResolvedValueOnce({
          data: [
            {
              broadcaster_user_id: 200,
              slug: "app-token-read",
              channel_description: "desc",
              stream_title: "title",
              banner_picture: null,
              category: null,
              stream: null,
            },
          ],
        }),
      });

      const result = await getChannel(client, "app-token-read");

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

    it("enriches public channel data with the real Kick user avatar by user_id", async () => {
      mockExecuteJavaScript.mockResolvedValueOnce(
        JSON.stringify({
          id: 14362387,
          user_id: 15132726,
          slug: "public-user-avatar",
          user: { username: "public-user-avatar" },
          livestream: null,
        })
      );

      const client = createMockClient({
        request: vi.fn().mockRejectedValueOnce(new Error("Kick API error: 401")),
      });
      getUsersByIdMock.mockResolvedValueOnce([
        {
          user_id: 15132726,
          name: "PublicUserAvatar",
          profile_picture: "https://kick.com/img/public-user-avatar.webp",
        },
      ]);

      const result = await getChannel(client, "public-user-avatar");

      expect(getUsersByIdMock).toHaveBeenCalledWith(client, [15132726]);
      expect(result!.id).toBe("14362387");
      expect(result!.kickUserId).toBe("15132726");
      expect(result!.displayName).toBe("PublicUserAvatar");
      expect(result!.avatarUrl).toBe("https://kick.com/img/public-user-avatar.webp");
    });

    it("keeps authenticated API identity mismatches out of warning logs", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
      mockLoadURL.mockRejectedValueOnce(new Error("timeout"));

      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            {
              broadcaster_user_id: 200,
              slug: "wrong-channel",
              channel_description: "",
              stream_title: "",
              banner_picture: null,
              category: null,
              stream: null,
            },
          ],
        }),
      });

      const result = await getChannel(client, "requested-channel");

      expect(result).toBeNull();
      expect(debugSpy).toHaveBeenCalledWith(
        "[Kick:Endpoints:Channel]",
        "API identity mismatch; rejecting response (Kick API bug)",
        expect.objectContaining({
          requestedSlug: "requested-channel",
          returnedSlug: "wrong-channel",
        })
      );
      expect(
        warnSpy.mock.calls.some(
          ([, message]) => message === "API identity mismatch; rejecting response (Kick API bug)"
        )
      ).toBe(false);
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
