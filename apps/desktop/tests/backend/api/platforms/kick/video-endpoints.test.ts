import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Module from "module";

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@backend/logging/logger", () => ({ logger: loggerMock }));

/* ------------------------------------------------------------------ *
 * Electron mock: video-endpoints.ts uses `require("electron")` (CJS) *
 * inside function bodies. vi.mock only intercepts ESM imports, so we  *
 * patch Module.prototype.require to return our mock for "electron".   *
 * ------------------------------------------------------------------ */
const mockNetFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

const _origRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === "electron") {
    return { net: { fetch: (...args: unknown[]) => mockNetFetch(...args) } };
  }
  return _origRequire.call(this, id);
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Guards: Kick VODs expose a public share URL only when the API supplies a canonical slug
// Guards: malformed and unavailable Kick VOD responses fail closed without exposing deleted content
// Guards: last-live fallback uses only trustworthy end timestamps from completed Kick VODs.
// Guards: Kick VOD cards retain channel avatars when legacy responses place them on the channel.
describe("video-endpoints — getVideosByChannelSlug", () => {
  let getVideosByChannelSlug: typeof import("@backend/api/platforms/kick/endpoints/video-endpoints").getVideosByChannelSlug;
  let getLatestCompletedVideoEndedAtByChannelSlug: typeof import("@backend/api/platforms/kick/endpoints/video-endpoints").getLatestCompletedVideoEndedAtByChannelSlug;

  beforeEach(async () => {
    vi.resetModules();
    mockNetFetch.mockReset();
    vi.clearAllMocks();
    // Default: return empty array
    mockNetFetch.mockResolvedValue(jsonResponse([]));
    ({ getVideosByChannelSlug, getLatestCompletedVideoEndedAtByChannelSlug } =
      await import("@backend/api/platforms/kick/endpoints/video-endpoints"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns mapped videos from a wrapped response with nextCursor", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse({
        videos: [
          {
            id: 100,
            uuid: "uuid-abc",
            slug: "video-slug-1",
            session_title: "Stream Title",
            duration: 7200000,
            views: 5000,
            created_at: "2026-01-15T12:00:00.000Z",
            thumbnail: { src: "https://files.kick.com/thumb.webp" },
            source: "https://example.com/vod.m3u8",
            is_live: false,
            channel: {
              slug: "streamer",
              user: {
                username: "Streamer",
                profile_pic: "https://example.com/avatar.webp",
              },
            },
            categories: [{ id: 1, name: "Just Chatting" }],
            language: "en",
          },
        ],
        nextCursor: "next-cursor-value",
      })
    );

    const result = await getVideosByChannelSlug("streamer");

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("100");
    expect(result.data[0].uuid).toBe("uuid-abc");
    expect(result.data[0].slug).toBe("video-slug-1");
    expect(result.data[0].shareUrl).toBe("https://kick.com/video/video-slug-1");
    expect(result.data[0].title).toBe("Stream Title");
    expect(result.data[0].duration).toBe("2:00:00");
    expect(result.data[0].views).toBe("5000");
    expect(result.data[0].source).toBe("https://example.com/vod.m3u8");
    expect(result.data[0].platform).toBe("kick");
    expect(result.data[0].isLive).toBe(false);
    expect(result.data[0].isSubOnly).toBe(false);
    expect(result.data[0].channelSlug).toBe("streamer");
    expect(result.data[0].channelName).toBe("Streamer");
    expect(result.data[0].category).toBe("Just Chatting");
    expect(result.cursor).toBe("next-cursor-value");
  });

  it("maps a channel-level legacy avatar when the nested user omits one", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 101,
          session_title: "Channel avatar fallback",
          duration: 3_600_000,
          created_at: "2026-08-20T12:00:00Z",
          channel: {
            slug: "streamer",
            profile_picture: "https://example.com/channel-avatar.webp",
            user: { username: "Streamer" },
          },
        },
      ])
    );

    const result = await getVideosByChannelSlug("streamer");

    expect(result.data[0].channelAvatar).toBe("https://example.com/channel-avatar.webp");
  });

  it("returns the newest source-backed end time from a completed video", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 90,
          session_title: "Currently live",
          duration: 0,
          source: "https://example.com/live.m3u8",
          is_live: true,
          created_at: "2026-08-02T16:00:00Z",
        },
        {
          id: 80,
          session_title: "Newest completed",
          duration: 7_200_000,
          source: "https://example.com/newest.m3u8",
          is_live: false,
          created_at: "2026-08-01T15:30:00Z",
        },
        {
          id: 70,
          session_title: "Missing timestamp",
          duration: 3_600_000,
          source: "https://example.com/missing.m3u8",
          is_live: false,
        },
        {
          id: 60,
          session_title: "Older completed",
          duration: 3_600_000,
          source: "https://example.com/older.m3u8",
          is_live: false,
          created_at: "2026-07-30T12:00:00Z",
        },
      ])
    );

    const result = await getLatestCompletedVideoEndedAtByChannelSlug("offline-streamer");

    expect(result).toBe("2026-08-01T17:30:00.000Z");
  });

  it("returns the end time of a finalized eight-hour VOD instead of its start time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T13:49:08Z"));
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 91,
          session_title: "Recently ended stream",
          duration: 28_907_000,
          source: "https://example.com/recently-ended.m3u8",
          is_live: false,
          start_time: "2026-08-03 05:34:30",
          created_at: "2026-08-03 05:34:34",
        },
      ])
    );

    const result = await getLatestCompletedVideoEndedAtByChannelSlug("iceposeidon");

    expect(result).toBe("2026-08-03T13:36:17.000Z");
  });

  it("prefers a completed VOD's explicit end time over its derived end", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 92,
          duration: 3_600_000,
          source: "https://example.com/explicit-end.m3u8",
          is_live: false,
          created_at: "2026-08-03T10:00:00Z",
          ended_at: "2026-08-03T11:05:00Z",
        },
      ])
    );

    const result = await getLatestCompletedVideoEndedAtByChannelSlug("explicit-end");

    expect(result).toBe("2026-08-03T11:05:00Z");
  });

  it("uses an explicit end time when Kick omits the VOD live state", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 99,
          ended_at: "2026-08-03T11:05:00Z",
        },
      ])
    );

    const result = await getLatestCompletedVideoEndedAtByChannelSlug("explicit-end-only");

    expect(result).toBe("2026-08-03T11:05:00Z");
  });

  it("does not derive an end time from a VOD still marked live", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 93,
          duration: 28_907_000,
          source: "https://example.com/still-live.m3u8",
          is_live: true,
          created_at: "2026-08-03T05:34:30Z",
        },
      ])
    );

    const result = await getLatestCompletedVideoEndedAtByChannelSlug("still-live");

    expect(result).toBeUndefined();
  });

  it("does not derive an end time when Kick omits the VOD live state", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 81,
          session_title: "Completed VOD without an is_live flag",
          duration: 5_400_000,
          source: "https://example.com/completed.m3u8",
          created_at: "2026-08-01T18:00:00Z",
        },
      ])
    );

    const result = await getLatestCompletedVideoEndedAtByChannelSlug("offline-streamer");

    expect(result).toBeUndefined();
  });

  it("does not derive an end time from invalid start or duration data", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 94,
          duration: 0,
          is_live: false,
          created_at: "2026-08-03T05:34:30Z",
        },
        {
          id: 95,
          duration: -1,
          is_live: false,
          created_at: "2026-08-03T05:34:30Z",
        },
        {
          id: 96,
          duration: "28907000",
          is_live: false,
          created_at: "2026-08-03T05:34:30Z",
        },
        {
          id: 97,
          duration: 28_907_000,
          is_live: false,
          created_at: "not-a-date",
        },
      ])
    );

    const result = await getLatestCompletedVideoEndedAtByChannelSlug("invalid-end-data");

    expect(result).toBeUndefined();
  });

  it("does not use updated_at as a completed VOD end time", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 98,
          duration: 0,
          is_live: false,
          created_at: "2026-08-03T05:34:30Z",
          updated_at: "2026-08-03T13:36:17Z",
        },
      ])
    );

    const result = await getLatestCompletedVideoEndedAtByChannelSlug("updated-at-only");

    expect(result).toBeUndefined();
  });

  it("handles raw array response (V2 format) and computes cursor from video count", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 200,
          session_title: "Array Stream",
          duration: 3600000,
          views: 100,
          created_at: "2026-01-10T08:00:00.000Z",
          source: "https://example.com/vod2.m3u8",
          is_live: false,
        },
        {
          id: 201,
          session_title: "Array Stream 2",
          duration: 1800000,
          views: 50,
          created_at: "2026-01-09T08:00:00.000Z",
          source: "https://example.com/vod3.m3u8",
          is_live: false,
        },
      ])
    );

    const result = await getVideosByChannelSlug("array-streamer", {
      cursor: "10",
    });

    expect(result.data).toHaveLength(2);
    expect(result.data[0].shareUrl).toBeUndefined();
    expect(result.cursor).toBe("12");
  });

  it("returns undefined cursor for empty array response", async () => {
    const result = await getVideosByChannelSlug("empty-streamer");

    expect(result.data).toEqual([]);
    expect(result.cursor).toBeUndefined();
  });

  it("filters out deleted videos", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 300,
          session_title: "Valid",
          source: "https://example.com/valid.m3u8",
          is_live: false,
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: 301,
          session_title: "Deleted",
          deleted_at: "2026-01-02T00:00:00Z",
          source: "https://example.com/del.m3u8",
          is_live: false,
          created_at: "2026-01-01T00:00:00Z",
        },
      ])
    );

    const result = await getVideosByChannelSlug("filter-streamer");

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("300");
  });

  it("filters out pruned videos (video.is_pruned)", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 400,
          session_title: "Pruned",
          video: { is_pruned: true },
          source: "x",
          is_live: false,
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: 401,
          session_title: "Not Pruned",
          video: { is_pruned: false },
          source: "x",
          is_live: false,
          created_at: "2026-01-01T00:00:00Z",
        },
      ])
    );

    const result = await getVideosByChannelSlug("pruned-streamer");

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("401");
  });

  it("filters out private videos (video.is_private)", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 500,
          session_title: "Private",
          video: { is_private: true },
          source: "x",
          is_live: false,
          created_at: "2026-01-01T00:00:00Z",
        },
      ])
    );

    const result = await getVideosByChannelSlug("private-streamer");

    expect(result.data).toHaveLength(0);
  });

  it("marks videos without source as subscriber-only (when not live)", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 600,
          slug: "sub-only-slug",
          session_title: "Sub Only",
          duration: 3600000,
          views: 100,
          is_live: false,
          created_at: "2026-01-01T00:00:00Z",
        },
      ])
    );

    const result = await getVideosByChannelSlug("sub-only-streamer");

    expect(mockNetFetch).toHaveBeenCalledTimes(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].isSubOnly).toBe(true);
    expect(result.data[0].source).toBe("");
  });

  it("does NOT mark live videos without source as subscriber-only", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 700,
          slug: "live-slug",
          session_title: "Live Stream",
          duration: 0,
          views: 0,
          is_live: true,
          created_at: "2026-01-01T00:00:00Z",
        },
      ])
    );

    const result = await getVideosByChannelSlug("live-streamer");

    expect(result.data).toHaveLength(1);
    expect(result.data[0].isSubOnly).toBe(false);
  });

  it("constructs correct URL with default options", async () => {
    await getVideosByChannelSlug("url-test");

    expect(mockNetFetch).toHaveBeenCalledTimes(1);
    const url = mockNetFetch.mock.calls[0][0] as string;
    expect(url).toContain("/channels/url-test/videos");
    expect(url).toContain("cursor=0");
    expect(url).toContain("limit=20");
    expect(url).toContain("sort=date");
    expect(url).toMatch(/_=\d+/);
  });

  it("maps sort 'views' to 'view' for Kick API", async () => {
    await getVideosByChannelSlug("sort-test", { sort: "views" });

    expect(mockNetFetch).toHaveBeenCalledTimes(1);
    expect(mockNetFetch.mock.calls[0][0] as string).toContain("sort=view");
  });

  it("returns empty data for 404 response", async () => {
    mockNetFetch.mockResolvedValueOnce(new Response("", { status: 404 }));

    const result = await getVideosByChannelSlug("nonexistent");

    expect(result).toEqual({ data: [] });
  });

  it("returns empty data when fetch throws", async () => {
    mockNetFetch.mockRejectedValueOnce(new Error("net::ERR_FAILED"));

    const result = await getVideosByChannelSlug("dead-channel");

    expect(result).toEqual({ data: [] });
  });

  it("keeps canceled video enrichment out of warning logs", async () => {
    mockNetFetch.mockRejectedValueOnce(new Error("net::ERR_ABORTED"));

    const result = await getVideosByChannelSlug("canceled-channel");

    expect(result).toEqual({ data: [] });
    expect(loggerMock.debug).toHaveBeenCalledWith(
      "Kick:Endpoints:Video",
      "Failed to fetch videos",
      expect.objectContaining({ slug: "canceled-channel" })
    );
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it("returns empty data on non-ok non-404 status", async () => {
    mockNetFetch.mockResolvedValueOnce(new Response("", { status: 500 }));

    const result = await getVideosByChannelSlug("error-channel");

    expect(result).toEqual({ data: [] });
  });

  it("sends cache-busting headers and options", async () => {
    await getVideosByChannelSlug("cache-test");

    expect(mockNetFetch).toHaveBeenCalledTimes(1);
    const options = mockNetFetch.mock.calls[0][1] as Record<string, unknown>;
    expect(options.cache).toBe("no-store");
    const headers = options.headers as Record<string, string>;
    expect(headers["Cache-Control"]).toBe("no-cache");
    expect(headers["Pragma"]).toBe("no-cache");
  });

  it("formats duration: sub-hour (m:ss)", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 800,
          session_title: "Short",
          duration: 150000,
          source: "x",
          is_live: false,
          created_at: "2026-01-01T00:00:00Z",
        },
      ])
    );

    const result = await getVideosByChannelSlug("dur-test");

    expect(result.data[0].duration).toBe("2:30");
  });

  it("formats duration: multi-hour (h:mm:ss)", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 801,
          session_title: "Long",
          duration: 3661000,
          source: "x",
          is_live: false,
          created_at: "2026-01-01T00:00:00Z",
        },
      ])
    );

    const result = await getVideosByChannelSlug("dur-test-long");

    expect(result.data[0].duration).toBe("1:01:01");
  });

  it("falls back to video.thumb for thumbnailUrl", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 900,
          session_title: "Thumb Fallback",
          video: { thumb: "https://example.com/video-thumb.webp" },
          source: "x",
          is_live: false,
          created_at: "2026-01-01T00:00:00Z",
        },
      ])
    );

    const result = await getVideosByChannelSlug("thumb-test");

    expect(mockNetFetch).toHaveBeenCalledTimes(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].thumbnailUrl).toBe("https://example.com/video-thumb.webp");
  });
});
