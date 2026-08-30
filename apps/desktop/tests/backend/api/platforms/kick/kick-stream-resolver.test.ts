import Module from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ *
 * Electron mock: kick-stream-resolver.ts uses `require("electron")`  *
 * (CJS) inside function bodies. vi.mock only intercepts ESM imports. *
 * ------------------------------------------------------------------ */
const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

const _origRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === "electron") {
    return { net: { fetch: (...args: unknown[]) => mockFetch(...args) } };
  }
  return _origRequire.call(this, id);
};

vi.mock("@shared/utils/sleep", () => ({
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock("@backend/logging/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { KickStreamResolver } from "@backend/api/platforms/kick/kick-stream-resolver";
import {
  __clearKickPlaybackCacheForTests,
  rememberKickLivePlaybackFromChannelPayload,
} from "@backend/api/platforms/kick/kick-playback-cache";
import { logger } from "@backend/logging/logger";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

// Guards: Kick live playback must log resolver timing without leaking full signed playback URLs.
// Guards: warmed Kick playback cache must resolve from memory without touching electron.net.fetch.
// Guards: forced Kick playback resolution must bypass warmed memory and refresh from the network.
describe("KickStreamResolver", () => {
  let resolver: KickStreamResolver;

  beforeEach(() => {
    resolver = new KickStreamResolver();
    mockFetch.mockReset();
    __clearKickPlaybackCacheForTests();
    vi.mocked(logger.debug).mockClear();
    vi.mocked(logger.error).mockClear();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warn).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getStreamPlaybackUrl", () => {
    it("returns HLS playback URL for a live channel", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          livestream: { is_live: true },
          playback_url:
            "https://fa723fc1b171.us-west-2.playback.live-video.net/api/video/v1/us-west-2.123456789.channel.abcdef.m3u8",
        })
      );

      const result = await resolver.getStreamPlaybackUrl("ac7ionman");

      expect(result).toEqual({
        url: "https://fa723fc1b171.us-west-2.playback.live-video.net/api/video/v1/us-west-2.123456789.channel.abcdef.m3u8",
        format: "hls",
      });
    });

    it("normalizes slug to lowercase", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          livestream: { is_live: true },
          playback_url: "https://example.com/stream.m3u8",
        })
      );

      await resolver.getStreamPlaybackUrl("Ac7ionMan");

      expect(mockFetch.mock.calls[0][0]).toContain("/channels/ac7ionman");
    });

    it("throws 'Channel is offline' when livestream.is_live is false", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ livestream: { is_live: false }, playback_url: "https://example.com/s.m3u8" })
      );

      await expect(resolver.getStreamPlaybackUrl("offline-channel")).rejects.toThrow(
        "Channel is offline"
      );
    });

    it("throws 'Channel is offline' when livestream is null", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ livestream: null, playback_url: "https://example.com/s.m3u8" })
      );

      await expect(resolver.getStreamPlaybackUrl("offline-channel")).rejects.toThrow(
        "Channel is offline"
      );
    });

    it("throws when no playback URL is found in response", async () => {
      // Provide fresh Response for each retry attempt (Response bodies are single-use)
      mockFetch.mockImplementation(async () => jsonResponse({ livestream: { is_live: true } }));

      await expect(resolver.getStreamPlaybackUrl("no-url-channel")).rejects.toThrow(
        "No playback URL found"
      );
    });

    it("does not preflight the HLS manifest before returning the playback URL", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          livestream: { is_live: true },
          playback_url: "https://example.com/stream.m3u8",
        })
      );

      const result = await resolver.getStreamPlaybackUrl("fast-channel");

      expect(result.url).toBe("https://example.com/stream.m3u8");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("returns a warmed playback URL from memory without a Kick network request", async () => {
      rememberKickLivePlaybackFromChannelPayload("fast-channel", {
        livestream: { is_live: true },
        playback_url: "https://playback.example.test/live/stream.m3u8?token=secret",
      });

      const result = await resolver.getStreamPlaybackUrl("fast-channel");

      expect(result).toEqual({
        url: "https://playback.example.test/live/stream.m3u8?token=secret",
        format: "hls",
      });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "Kick:StreamResolver",
        "resolved live playback URL",
        expect.objectContaining({
          channelSlug: "fast-channel",
          attempt: 0,
          cacheSource: "memory",
          requestDurationMs: 0,
          urlHost: "playback.example.test",
        })
      );
    });

    it("bypasses warmed playback when a fresh resolution is forced", async () => {
      rememberKickLivePlaybackFromChannelPayload("fast-channel", {
        livestream: { is_live: true },
        playback_url: "https://playback.example.test/live/stale.m3u8",
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          livestream: { is_live: true },
          playback_url: "https://playback.example.test/live/fresh.m3u8",
        })
      );

      const result = await resolver.getStreamPlaybackUrl("fast-channel", { forceRefresh: true });

      expect(result).toEqual({
        url: "https://playback.example.test/live/fresh.m3u8",
        format: "hls",
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("logs successful live playback timing without the signed URL", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          livestream: { is_live: true },
          playback_url: "https://playback.example.test/live/stream.m3u8?token=secret",
        })
      );

      await resolver.getStreamPlaybackUrl("fast-channel");

      expect(logger.info).toHaveBeenCalledWith(
        "Kick:StreamResolver",
        "resolved live playback URL",
        expect.objectContaining({
          channelSlug: "fast-channel",
          attempt: 1,
          urlHost: "playback.example.test",
          sourceField: "playback_url",
        })
      );
      expect(logger.info).not.toHaveBeenCalledWith(
        "Kick:StreamResolver",
        "resolved live playback URL",
        expect.objectContaining({ url: expect.stringContaining("token=secret") })
      );
    });

    it("uses livestream.source as fallback when playback_url is missing", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          livestream: { is_live: true, source: "https://example.com/source.m3u8" },
        })
      );

      const result = await resolver.getStreamPlaybackUrl("source-channel");

      expect(result.url).toBe("https://example.com/source.m3u8");
    });

    it("throws on 404 without retrying", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, 404));

      await expect(resolver.getStreamPlaybackUrl("nonexistent")).rejects.toThrow("not found");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("retries transient errors up to maxRetries", async () => {
      mockFetch.mockRejectedValueOnce(new Error("net::ERR_FAILED")).mockResolvedValueOnce(
        jsonResponse({
          livestream: { is_live: true },
          playback_url: "https://example.com/stream.m3u8",
        })
      );

      const result = await resolver.getStreamPlaybackUrl("flaky-channel");

      expect(result.url).toBe("https://example.com/stream.m3u8");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws after exhausting all retries", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("net::ERR_FAILED"))
        .mockRejectedValueOnce(new Error("net::ERR_FAILED"));

      await expect(resolver.getStreamPlaybackUrl("dead-channel")).rejects.toThrow(
        "net::ERR_FAILED"
      );
    });
  });

  describe("getVodPlaybackUrl", () => {
    it("returns directly when input is already an HTTP URL", async () => {
      const result = await resolver.getVodPlaybackUrl("https://example.com/vod/v1/stream.m3u8");

      expect(result).toEqual({
        url: "https://example.com/vod/v1/stream.m3u8",
        format: "hls",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("fetches source URL from video endpoint given a UUID", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ source: "https://example.com/vod.m3u8" }));

      const result = await resolver.getVodPlaybackUrl("DsuAwCgUc9Bh");

      expect(result).toEqual({
        url: "https://example.com/vod.m3u8",
        format: "hls",
      });
    });

    it("tries numeric ID extraction for slug-formatted IDs", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 404))
        .mockResolvedValueOnce(jsonResponse({ source: "https://example.com/numeric-vod.m3u8" }));

      const result = await resolver.getVodPlaybackUrl("86960612-stream-title");

      expect(result.url).toBe("https://example.com/numeric-vod.m3u8");
    });

    it("throws descriptive error when all resolution attempts fail", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ message: "Not Found" }, 404));

      await expect(resolver.getVodPlaybackUrl("unknown-uuid")).rejects.toThrow(
        /Could not resolve VOD/
      );
      expect(logger.warn).toHaveBeenCalledWith(
        "Kick:StreamResolver",
        "Kick VOD unavailable",
        expect.objectContaining({
          videoIdOrUuid: "unknown-uuid",
          reason: expect.stringContaining("Could not resolve VOD playback URL"),
        })
      );
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe("getVideoMetadata", () => {
    // Guards: Kick VOD metadata lookup must fail closed when the upstream
    // route cannot resolve a real video, rather than inventing placeholder
    // titles or channel identities.
    it("returns full metadata from a valid API response", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 123,
          session_title: "Epic Stream",
          channel: {
            id: 456,
            slug: "streamer",
            user: { username: "Streamer", profile_pic: "https://example.com/avatar.webp" },
          },
          views: 5000,
          duration: 7200000,
          created_at: "2026-01-15T12:00:00Z",
          thumbnail: { src: "https://example.com/thumb.webp" },
          categories: [{ id: 1, name: "Just Chatting" }],
        })
      );

      const meta = await resolver.getVideoMetadata("some-uuid");
      expect(meta).not.toBeNull();
      if (!meta) throw new Error("Expected metadata");

      expect(meta.id).toBe("123");
      expect(meta.title).toBe("Epic Stream");
      expect(meta.channelId).toBe("456");
      expect(meta.channelName).toBe("streamer");
      expect(meta.channelDisplayName).toBe("Streamer");
      expect(meta.channelAvatar).toBe("https://example.com/avatar.webp");
      expect(meta.views).toBe(5000);
      expect(meta.duration).toBe("2:00:00");
      expect(meta.thumbnailUrl).toBe("https://example.com/thumb.webp");
      expect(meta.category).toBe("Just Chatting");
      expect(meta.platform).toBe("kick");
    });

    it("returns null when the API call fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const meta = await resolver.getVideoMetadata("bad-uuid");

      expect(meta).toBeNull();
    });

    it("formats duration correctly for sub-hour videos", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1, duration: 150000, channel: {} }));

      const meta = await resolver.getVideoMetadata("short-vod");
      expect(meta).not.toBeNull();
      if (!meta) throw new Error("Expected metadata");

      expect(meta.duration).toBe("2:30");
    });

    it("formats duration correctly for zero-length videos", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1, duration: 0, channel: {} }));

      const meta = await resolver.getVideoMetadata("zero-vod");
      expect(meta).not.toBeNull();
      if (!meta) throw new Error("Expected metadata");

      expect(meta.duration).toBe("0:00");
    });

    it("falls back to livestream nested channel data", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 789,
          livestream: {
            channel: {
              id: 321,
              slug: "nested-streamer",
              user: { username: "NestedStreamer", profile_pic: "https://example.com/nested.webp" },
            },
            categories: [{ id: 2, name: "Gaming" }],
          },
        })
      );

      const meta = await resolver.getVideoMetadata("nested-uuid");
      expect(meta).not.toBeNull();
      if (!meta) throw new Error("Expected metadata");

      expect(meta.channelId).toBe("321");
      expect(meta.channelName).toBe("nested-streamer");
      expect(meta.channelDisplayName).toBe("NestedStreamer");
      expect(meta.category).toBe("Gaming");
    });
  });
});
