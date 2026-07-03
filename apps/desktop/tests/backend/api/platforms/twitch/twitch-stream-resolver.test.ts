import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cross-logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

const mockGqlIsChannelLive = vi.fn();
const mockGqlGetPlaybackAccessToken = vi.fn();
const mockGqlGetVodAccessToken = vi.fn();
const mockGqlGetClipAccessToken = vi.fn();

vi.mock("@/backend/api/platforms/twitch/twitch-gql-client", () => ({
  gqlIsChannelLive: (...args: unknown[]) => mockGqlIsChannelLive(...args),
  gqlGetPlaybackAccessToken: (...args: unknown[]) => mockGqlGetPlaybackAccessToken(...args),
  gqlGetVodAccessToken: (...args: unknown[]) => mockGqlGetVodAccessToken(...args),
  gqlGetClipAccessToken: (...args: unknown[]) => mockGqlGetClipAccessToken(...args),
}));

import { TwitchStreamResolver } from "@/backend/api/platforms/twitch/twitch-stream-resolver";
import {
  decodeTwitchClipMediaUrl,
  TWITCH_CLIP_MEDIA_SCHEME,
} from "@/backend/protocols/twitch-clip-media-url";
import { logger } from "@/lib/cross-logger";

// Guards: Twitch live playback must log one-token-request timing without restoring the live-status preflight.
describe("TwitchStreamResolver", () => {
  let resolver: TwitchStreamResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    resolver = new TwitchStreamResolver();
  });

  describe("getStreamPlaybackUrl", () => {
    it("returns HLS URL when channel is live", async () => {
      mockGqlGetPlaybackAccessToken.mockResolvedValueOnce({
        value: "token-value",
        signature: "sig123",
      });

      const result = await resolver.getStreamPlaybackUrl("testchannel");

      expect(result.format).toBe("hls");
      expect(result.url).toContain("usher.ttvnw.net/api/channel/hls/testchannel.m3u8");
      expect(result.url).toContain("token=");
      expect(result.url).toContain("sig=sig123");
      expect(result.url).toContain("allow_source=true");
      expect(result.url).toContain("allow_audio_only=true");
      expect(mockGqlIsChannelLive).not.toHaveBeenCalled();
    });

    it("logs successful live playback timing without the signed URL", async () => {
      mockGqlGetPlaybackAccessToken.mockResolvedValueOnce({
        value: "token-value",
        signature: "sig123",
      });

      await resolver.getStreamPlaybackUrl("TestChannel");

      expect(logger.info).toHaveBeenCalledWith(
        "Twitch:StreamResolver",
        "resolved live playback URL",
        expect.objectContaining({
          channelLogin: "testchannel",
          urlHost: "usher.ttvnw.net",
        })
      );
      expect(logger.info).not.toHaveBeenCalledWith(
        "Twitch:StreamResolver",
        "resolved live playback URL",
        expect.objectContaining({ url: expect.stringContaining("token-value") })
      );
    });

    it("re-throws playback token errors", async () => {
      mockGqlGetPlaybackAccessToken.mockRejectedValueOnce(new Error("Channel is offline"));

      await expect(resolver.getStreamPlaybackUrl("offline")).rejects.toThrow("Channel is offline");
    });

    it("re-throws GQL errors", async () => {
      mockGqlGetPlaybackAccessToken.mockRejectedValueOnce(new Error("GQL network error"));

      await expect(resolver.getStreamPlaybackUrl("broken")).rejects.toThrow("GQL network error");
    });
  });

  describe("getVodPlaybackUrl", () => {
    it("returns HLS URL for a VOD", async () => {
      mockGqlGetVodAccessToken.mockResolvedValueOnce({
        value: "vod-token",
        signature: "vod-sig",
      });

      const result = await resolver.getVodPlaybackUrl("12345");

      expect(result.format).toBe("hls");
      expect(result.url).toContain("usher.ttvnw.net/vod/12345.m3u8");
      expect(result.url).toContain("sig=vod-sig");
    });

    it("re-throws errors from GQL", async () => {
      mockGqlGetVodAccessToken.mockRejectedValueOnce(new Error("VOD not found"));

      await expect(resolver.getVodPlaybackUrl("bad")).rejects.toThrow("VOD not found");
    });
  });

  describe("getClipPlaybackUrl", () => {
    it("returns best quality MP4 URL through the custom clip media protocol", async () => {
      mockGqlGetClipAccessToken.mockResolvedValueOnce({
        value: "clip-token",
        signature: "clip-sig",
        qualities: [
          {
            quality: "480",
            sourceURL: "https://d1ndex63qxojbr.cloudfront.net/480.mp4",
            frameRate: 30,
          },
          {
            quality: "1080",
            sourceURL: "https://d1ndex63qxojbr.cloudfront.net/1080.mp4",
            frameRate: 60,
          },
          {
            quality: "720",
            sourceURL: "https://d1ndex63qxojbr.cloudfront.net/720.mp4",
            frameRate: 30,
          },
        ],
      });

      const result = await resolver.getClipPlaybackUrl("my-clip");
      const encodedUrl = new URL(result.url).searchParams.get("u");

      expect(result.format).toBe("mp4");
      expect(result.url.startsWith(`${TWITCH_CLIP_MEDIA_SCHEME}://media?u=`)).toBe(true);
      expect(encodedUrl).not.toBeNull();
      expect(decodeTwitchClipMediaUrl(encodedUrl!)).toBe(
        "https://d1ndex63qxojbr.cloudfront.net/1080.mp4?sig=clip-sig&token=clip-token"
      );
      expect(result.qualities).toHaveLength(3);
      expect(result.qualities![0].quality).toBe("1080p");
      expect(result.qualities![1].quality).toBe("720p");
      expect(result.qualities![2].quality).toBe("480p");
      expect(result.qualities![0].url.startsWith(`${TWITCH_CLIP_MEDIA_SCHEME}://media?u=`)).toBe(
        true
      );
    });

    it("throws when no qualities are returned", async () => {
      mockGqlGetClipAccessToken.mockResolvedValueOnce({
        value: "t",
        signature: "s",
        qualities: [],
      });

      await expect(resolver.getClipPlaybackUrl("empty")).rejects.toThrow(
        "No video qualities found"
      );
    });

    it("throws when qualities is undefined", async () => {
      mockGqlGetClipAccessToken.mockResolvedValueOnce({
        value: "t",
        signature: "s",
        qualities: undefined,
      });

      await expect(resolver.getClipPlaybackUrl("no-q")).rejects.toThrow("No video qualities found");
    });

    it("filters out entries with empty sourceURL", async () => {
      mockGqlGetClipAccessToken.mockResolvedValueOnce({
        value: "t",
        signature: "s",
        qualities: [
          { quality: "1080", sourceURL: "", frameRate: 60 },
          {
            quality: "720",
            sourceURL: "https://d1ndex63qxojbr.cloudfront.net/720.mp4",
            frameRate: 30,
          },
        ],
      });

      const result = await resolver.getClipPlaybackUrl("partial");
      const encodedUrl = new URL(result.url).searchParams.get("u");

      expect(result.qualities).toHaveLength(1);
      expect(decodeTwitchClipMediaUrl(encodedUrl!)).toBe(
        "https://d1ndex63qxojbr.cloudfront.net/720.mp4?sig=s&token=t"
      );
    });

    it("throws when all qualities have empty sourceURL", async () => {
      mockGqlGetClipAccessToken.mockResolvedValueOnce({
        value: "t",
        signature: "s",
        qualities: [
          { quality: "1080", sourceURL: "", frameRate: 60 },
          { quality: "720", sourceURL: "", frameRate: 30 },
        ],
      });

      await expect(resolver.getClipPlaybackUrl("no-valid")).rejects.toThrow(
        "No valid video qualities"
      );
    });

    it("re-throws GQL errors", async () => {
      mockGqlGetClipAccessToken.mockRejectedValueOnce(new Error("Clip not found"));

      await expect(resolver.getClipPlaybackUrl("broken")).rejects.toThrow("Clip not found");
    });
  });
});
