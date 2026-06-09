import Module from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ *
 * Electron mock: kick-stream-resolver.ts uses `require("electron")`  *
 * (CJS) inside function bodies. vi.mock only intercepts ESM imports. *
 * ------------------------------------------------------------------ */
const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

const _origRequire = Module.prototype.require;
(Module.prototype as any).require = function (id: string) {
  if (id === "electron") {
    return { net: { fetch: (...args: unknown[]) => mockFetch(...args) } };
  }
  return _origRequire.apply(this, [id] as any);
};

vi.mock("@/lib/sleep", () => ({
  sleep: vi.fn(() => Promise.resolve()),
}));

import { KickStreamResolver } from "@/backend/api/platforms/kick/kick-stream-resolver";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe("KickStreamResolver", () => {
  let resolver: KickStreamResolver;

  beforeEach(() => {
    resolver = new KickStreamResolver();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getStreamPlaybackUrl", () => {
    it("returns HLS playback URL for a live channel", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            livestream: { is_live: true },
            playback_url:
              "https://fa723fc1b171.us-west-2.playback.live-video.net/api/video/v1/us-west-2.123456789.channel.abcdef.m3u8",
          })
        )
        .mockResolvedValueOnce(new Response("", { status: 200 }));

      const result = await resolver.getStreamPlaybackUrl("ac7ionman");

      expect(result).toEqual({
        url: "https://fa723fc1b171.us-west-2.playback.live-video.net/api/video/v1/us-west-2.123456789.channel.abcdef.m3u8",
        format: "hls",
      });
    });

    it("normalizes slug to lowercase", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            livestream: { is_live: true },
            playback_url: "https://example.com/stream.m3u8",
          })
        )
        .mockResolvedValueOnce(new Response("", { status: 200 }));

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

    it("throws 'Channel is offline' when validatePlaybackUrl returns 404", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            livestream: { is_live: true },
            playback_url: "https://example.com/stream.m3u8",
          })
        )
        .mockResolvedValueOnce(new Response("", { status: 404 }));

      await expect(resolver.getStreamPlaybackUrl("stale-channel")).rejects.toThrow(
        "Channel is offline"
      );
    });

    it("throws 'Channel is offline' when validatePlaybackUrl returns 403", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            livestream: { is_live: true },
            playback_url: "https://example.com/stream.m3u8",
          })
        )
        .mockResolvedValueOnce(new Response("", { status: 403 }));

      await expect(resolver.getStreamPlaybackUrl("forbidden-channel")).rejects.toThrow(
        "Channel is offline"
      );
    });

    it("uses livestream.source as fallback when playback_url is missing", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            livestream: { is_live: true, source: "https://example.com/source.m3u8" },
          })
        )
        .mockResolvedValueOnce(new Response("", { status: 200 }));

      const result = await resolver.getStreamPlaybackUrl("source-channel");

      expect(result.url).toBe("https://example.com/source.m3u8");
    });

    it("throws on 404 without retrying", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, 404));

      await expect(resolver.getStreamPlaybackUrl("nonexistent")).rejects.toThrow("not found");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("retries transient errors up to maxRetries", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("net::ERR_FAILED"))
        .mockResolvedValueOnce(
          jsonResponse({
            livestream: { is_live: true },
            playback_url: "https://example.com/stream.m3u8",
          })
        )
        .mockResolvedValueOnce(new Response("", { status: 200 }));

      const result = await resolver.getStreamPlaybackUrl("flaky-channel");

      expect(result.url).toBe("https://example.com/stream.m3u8");
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("throws after exhausting all retries", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("net::ERR_FAILED"))
        .mockRejectedValueOnce(new Error("net::ERR_FAILED"));

      await expect(resolver.getStreamPlaybackUrl("dead-channel")).rejects.toThrow(
        "net::ERR_FAILED"
      );
    });

    it("treats validatePlaybackUrl timeout as valid (assumes URL might work)", async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            livestream: { is_live: true },
            playback_url: "https://example.com/stream.m3u8",
          })
        )
        .mockRejectedValueOnce(new Error("timeout"));

      const result = await resolver.getStreamPlaybackUrl("slow-validation");

      expect(result.url).toBe("https://example.com/stream.m3u8");
      expect(timeoutSpy).toHaveBeenNthCalledWith(1, 5000);
      expect(timeoutSpy).toHaveBeenNthCalledWith(2, 1500);
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
    });
  });

  describe("getVideoMetadata", () => {
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

    it("returns default metadata when API call fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const meta = await resolver.getVideoMetadata("bad-uuid");

      expect(meta.id).toBe("bad-uuid");
      expect(meta.title).toBe("Kick VOD");
      expect(meta.channelId).toBe("");
      expect(meta.views).toBe(0);
      expect(meta.duration).toBe("0:00");
      expect(meta.platform).toBe("kick");
    });

    it("formats duration correctly for sub-hour videos", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1, duration: 150000, channel: {} }));

      const meta = await resolver.getVideoMetadata("short-vod");

      expect(meta.duration).toBe("2:30");
    });

    it("formats duration correctly for zero-length videos", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1, duration: 0, channel: {} }));

      const meta = await resolver.getVideoMetadata("zero-vod");

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

      expect(meta.channelId).toBe("321");
      expect(meta.channelName).toBe("nested-streamer");
      expect(meta.channelDisplayName).toBe("NestedStreamer");
      expect(meta.category).toBe("Gaming");
    });
  });
});
