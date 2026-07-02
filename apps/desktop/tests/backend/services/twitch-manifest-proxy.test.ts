import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  session: {
    defaultSession: {
      webRequest: {
        onBeforeRequest: vi.fn(),
      },
    },
  },
}));

vi.mock("@/lib/sleep", () => ({
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/backend/services/vaft-pattern-service", () => ({
  vaftPatternService: {
    getDateRangePatterns: vi.fn(() => [
      "stitched-ad",
      "com.twitch.tv/ad",
      "amazon-ad",
    ]),
    getAdSignifiers: vi.fn(() => ["stitched"]),
  },
}));

vi.mock("@/backend/services/http-client", () => ({
  httpClient: {
    fetch: vi.fn(),
  },
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { twitchManifestProxy } from "@/backend/services/twitch-manifest-proxy";

// ========== M3U8 Fixtures ==========

const MASTER_PLAYLIST = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2",FRAME-RATE=60.000
https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2",FRAME-RATE=30.000
https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/720p30.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=250000,RESOLUTION=284x160,CODECS="avc1.4D400C,mp4a.40.2",FRAME-RATE=30.000
https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/160p.m3u8`;

const CLEAN_MEDIA_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:42
#EXT-X-PROGRAM-DATE-TIME:2025-01-01T00:00:00.000Z
#EXTINF:2.000,live
https://video-weaver.lax01.hls.ttvnw.net/v1/segment/source/seg-42.ts
#EXTINF:2.000,live
https://video-weaver.lax01.hls.ttvnw.net/v1/segment/source/seg-43.ts
#EXT-X-TWITCH-PREFETCH:https://video-weaver.lax01.hls.ttvnw.net/v1/segment/source/seg-44.ts`;

const AD_MEDIA_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:42
#EXT-X-DATERANGE:ID="stitched-ad-1234",CLASS="twitch-stitched-ad",START-DATE="2025-01-01T00:00:00Z",DURATION=30.0
#EXT-X-DISCONTINUITY
#EXTINF:2.000,
https://d2nvs31859zcd8.cloudfront.net/ad/segment-1.ts
#EXTINF:2.000,
https://d2nvs31859zcd8.cloudfront.net/ad/segment-2.ts
X-TV-TWITCH-AD-URL="https://tracking.twitch.tv/ad/click"
X-TV-TWITCH-AD-CLICK-TRACKING-URL="https://tracking.twitch.tv/ad/track"
X-TV-TWITCH-AD-ROLL-TYPE="preroll"`;

const AD_PLAYLIST_WITH_STITCHED = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXTINF:2.000,
https://video-weaver.lax01.hls.ttvnw.net/v1/segment/stitched/seg-1.ts`;

// ========== Helper to access private methods ==========

function proxy(): any {
  return twitchManifestProxy;
}

describe("TwitchManifestProxyService", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    proxy().streamInfos.clear();
    proxy().isEnabled = true;
    proxy().isRegistered = false;
    proxy().stats = {
      manifestsProcessed: 0,
      adsDetected: 0,
      backupsFetched: 0,
      segmentsReplaced: 0,
    };
  });

  afterEach(() => {
    proxy().clearAllStreamInfos();
  });

  // ========== Public API ==========

  describe("enable/disable", () => {
    it("enable sets isEnabled to true", () => {
      twitchManifestProxy.disable();
      twitchManifestProxy.enable();
      expect(proxy().isEnabled).toBe(true);
    });

    it("disable sets isEnabled to false", () => {
      twitchManifestProxy.disable();
      expect(proxy().isEnabled).toBe(false);
    });
  });

  describe("isActive", () => {
    it("returns false when not registered", () => {
      expect(twitchManifestProxy.isActive()).toBe(false);
    });

    it("returns false when disabled even if registered", () => {
      proxy().isRegistered = true;
      twitchManifestProxy.disable();
      expect(twitchManifestProxy.isActive()).toBe(false);
    });

    it("returns true when enabled and registered", () => {
      proxy().isRegistered = true;
      proxy().isEnabled = true;
      expect(twitchManifestProxy.isActive()).toBe(true);
    });
  });

  describe("getStats", () => {
    it("returns a copy of stats", () => {
      const stats = twitchManifestProxy.getStats();
      expect(stats).toEqual({
        manifestsProcessed: 0,
        adsDetected: 0,
        backupsFetched: 0,
        segmentsReplaced: 0,
      });
      stats.manifestsProcessed = 999;
      expect(twitchManifestProxy.getStats().manifestsProcessed).toBe(0);
    });
  });

  describe("clearStreamInfo", () => {
    it("removes stream info for a channel", () => {
      proxy().streamInfos.set("testchannel", { channelName: "testchannel" });
      twitchManifestProxy.clearStreamInfo("TestChannel");
      expect(proxy().streamInfos.has("testchannel")).toBe(false);
    });
  });

  describe("clearAllStreamInfos", () => {
    it("clears all stream infos", () => {
      proxy().streamInfos.set("ch1", {});
      proxy().streamInfos.set("ch2", {});
      twitchManifestProxy.clearAllStreamInfos();
      expect(proxy().streamInfos.size).toBe(0);
    });
  });

  // ========== extractChannelName ==========

  describe("extractChannelName", () => {
    it("extracts channel name from usher URL", () => {
      const result = proxy().extractChannelName(
        "https://usher.ttvnw.net/api/channel/hls/xqc.m3u8?allow_source=true"
      );
      expect(result).toBe("xqc");
    });

    it("extracts lowercase channel name", () => {
      const result = proxy().extractChannelName(
        "https://usher.ttvnw.net/api/channel/hls/XQC.m3u8"
      );
      expect(result).toBe("xqc");
    });

    it("extracts channel name from current usher URL shape", () => {
      const result = proxy().extractChannelName(
        "https://usher.ttvnw.net/api/channel/JamiePineLive.m3u8?allow_source=true"
      );
      expect(result).toBe("jamiepinelive");
    });

    it("returns null for non-matching URL", () => {
      const result = proxy().extractChannelName(
        "https://example.com/video.mp4"
      );
      expect(result).toBeNull();
    });
  });

  // ========== isMasterPlaylist ==========

  describe("isMasterPlaylist", () => {
    it("returns true for usher URLs", () => {
      expect(
        proxy().isMasterPlaylist(
          "https://usher.ttvnw.net/api/channel/hls/test.m3u8"
        )
      ).toBe(true);
    });

    it("returns false for video-weaver URLs", () => {
      expect(
        proxy().isMasterPlaylist(
          "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8"
        )
      ).toBe(false);
    });
  });

  // ========== parseAttributes ==========

  describe("parseAttributes", () => {
    it("parses standard HLS attributes", () => {
      const line =
        '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2",FRAME-RATE=60.000';
      const attrs = proxy().parseAttributes(line);

      expect(attrs.BANDWIDTH).toBe("6000000");
      expect(attrs.RESOLUTION).toBe("1920x1080");
      expect(attrs.CODECS).toBe("avc1.64002A,mp4a.40.2");
      expect(attrs["FRAME-RATE"]).toBe("60.000");
    });

    it("strips quotes from attribute values", () => {
      const line = '#EXT-X-STREAM-INF:CODECS="avc1.4D401F"';
      const attrs = proxy().parseAttributes(line);
      expect(attrs.CODECS).toBe("avc1.4D401F");
    });
  });

  // ========== processMasterPlaylist ==========

  describe("processMasterPlaylist", () => {
    it("stores stream info with resolutions", () => {
      const url =
        "https://usher.ttvnw.net/api/channel/hls/teststreamer.m3u8?allow_source=true";
      proxy().processMasterPlaylist(url, MASTER_PLAYLIST);

      expect(proxy().streamInfos.has("teststreamer")).toBe(true);
      const info = proxy().streamInfos.get("teststreamer");
      expect(info.resolutions.size).toBe(3);
      expect(info.channelName).toBe("teststreamer");
    });

    it("identifies 160p stream URL", () => {
      const url =
        "https://usher.ttvnw.net/api/channel/hls/teststreamer.m3u8?allow_source=true";
      proxy().processMasterPlaylist(url, MASTER_PLAYLIST);

      const info = proxy().streamInfos.get("teststreamer");
      expect(info.baseline160pUrl).toBe(
        "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/160p.m3u8"
      );
    });

    it("stores usher params", () => {
      const url =
        "https://usher.ttvnw.net/api/channel/hls/test.m3u8?allow_source=true&token=abc";
      proxy().processMasterPlaylist(url, MASTER_PLAYLIST);

      const info = proxy().streamInfos.get("test");
      expect(info.usherParams).toContain("allow_source=true");
    });

    it("returns unmodified text", () => {
      const url =
        "https://usher.ttvnw.net/api/channel/hls/test.m3u8";
      const result = proxy().processMasterPlaylist(url, MASTER_PLAYLIST);
      expect(result).toBe(MASTER_PLAYLIST);
    });

    it("returns text unmodified if channel name cannot be extracted", () => {
      const result = proxy().processMasterPlaylist(
        "https://example.com/video.mp4",
        MASTER_PLAYLIST
      );
      expect(result).toBe(MASTER_PLAYLIST);
    });
  });

  // ========== detectAds ==========

  describe("detectAds", () => {
    it("detects ads via DATERANGE patterns", () => {
      expect(proxy().detectAds(AD_MEDIA_PLAYLIST)).toBe(true);
    });

    it("detects ads via signifiers", () => {
      expect(proxy().detectAds(AD_PLAYLIST_WITH_STITCHED)).toBe(true);
    });

    it("returns false for clean playlist", () => {
      expect(proxy().detectAds(CLEAN_MEDIA_PLAYLIST)).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(proxy().detectAds("")).toBe(false);
    });
  });

  // ========== neutralizeTrackingUrls ==========

  describe("neutralizeTrackingUrls", () => {
    it("replaces ad URL with safe URL", () => {
      const input =
        'X-TV-TWITCH-AD-URL="https://tracking.twitch.tv/ad/click"';
      const result = proxy().neutralizeTrackingUrls(input);
      expect(result).toContain("https://twitch.tv");
      expect(result).not.toContain("tracking.twitch.tv");
    });

    it("replaces click tracking URL", () => {
      const input =
        'X-TV-TWITCH-AD-CLICK-TRACKING-URL="https://tracking.twitch.tv/track"';
      const result = proxy().neutralizeTrackingUrls(input);
      expect(result).toContain("https://twitch.tv");
    });

    it("empties roll type", () => {
      const input = 'X-TV-TWITCH-AD-ROLL-TYPE="preroll"';
      const result = proxy().neutralizeTrackingUrls(input);
      expect(result).toBe('X-TV-TWITCH-AD-ROLL-TYPE=""');
    });

    it("leaves non-tracking content unchanged", () => {
      const input = "#EXTINF:2.000,live\nhttps://video-weaver.com/seg.ts";
      const result = proxy().neutralizeTrackingUrls(input);
      expect(result).toBe(input);
    });
  });

  // ========== isKnownAdSegment ==========

  describe("isKnownAdSegment", () => {
    it("detects cloudfront ad segments", () => {
      expect(
        proxy().isKnownAdSegment(
          "https://d2nvs31859zcd8.cloudfront.net/ad/segment.ts"
        )
      ).toBe(true);
    });

    it("detects amazon-ad segments", () => {
      expect(
        proxy().isKnownAdSegment(
          "https://example.com/amazon-ad/segment.ts"
        )
      ).toBe(true);
    });

    it("detects stitched-ad segments", () => {
      expect(
        proxy().isKnownAdSegment(
          "https://example.com/stitched-ad/segment.ts"
        )
      ).toBe(true);
    });

    it("returns false for normal segments", () => {
      expect(
        proxy().isKnownAdSegment(
          "https://video-weaver.lax01.hls.ttvnw.net/v1/segment/source/seg.ts"
        )
      ).toBe(false);
    });
  });

  // ========== stripAdSegmentsMinimal ==========

  describe("stripAdSegmentsMinimal", () => {
    it("removes DATERANGE ad markers", () => {
      const result = proxy().stripAdSegmentsMinimal(AD_MEDIA_PLAYLIST);
      expect(result).not.toContain("stitched-ad");
    });

    it("removes prefetch lines", () => {
      const input = `#EXTM3U
#EXT-X-TWITCH-PREFETCH:https://example.com/prefetch.ts
#EXTINF:2.000,live
https://example.com/seg.ts`;
      const result = proxy().stripAdSegmentsMinimal(input);
      expect(result).not.toContain("PREFETCH");
    });

    it("preserves non-ad content", () => {
      const result = proxy().stripAdSegmentsMinimal(CLEAN_MEDIA_PLAYLIST);
      expect(result).toContain("#EXTM3U");
      expect(result).toContain("seg-42.ts");
    });
  });

  // ========== replaceAdSegments ==========

  describe("replaceAdSegments", () => {
    it("replaces ad segment URLs with 160p segment", () => {
      const streamInfo = {
        channelName: "test",
        last160pSegment: "https://replacement-segment.ts",
        isInAdBreak: true,
        resolutions: new Map(),
      };

      const input = `#EXTM3U
#EXTINF:2.000,
https://d2nvs31859zcd8.cloudfront.net/ad/segment.ts`;

      const result = proxy().replaceAdSegments(input, streamInfo);
      expect(result).toContain("https://replacement-segment.ts");
      expect(result).not.toContain("cloudfront.net/ad/");
    });

    it("strips prefetch during ad break", () => {
      const streamInfo = {
        channelName: "test",
        last160pSegment: "https://replacement.ts",
        isInAdBreak: true,
        resolutions: new Map(),
      };

      const input = `#EXTM3U
#EXT-X-TWITCH-PREFETCH:https://example.com/prefetch.ts
#EXTINF:2.000,live
https://example.com/seg.ts`;

      const result = proxy().replaceAdSegments(input, streamInfo);
      expect(result).not.toContain("PREFETCH");
    });

    it("falls back to minimal stripping when no 160p segment available", () => {
      const streamInfo = {
        channelName: "test",
        last160pSegment: null,
        isInAdBreak: true,
        resolutions: new Map(),
      };

      const result = proxy().replaceAdSegments(AD_MEDIA_PLAYLIST, streamInfo);
      expect(result).not.toContain("stitched-ad");
    });

    it("increments segmentsReplaced stat", () => {
      const streamInfo = {
        channelName: "test",
        last160pSegment: "https://replacement.ts",
        isInAdBreak: false,
        resolutions: new Map(),
      };

      const input = `#EXTM3U
#EXTINF:2.000,
https://d2nvs31859zcd8.cloudfront.net/ad/seg.ts`;

      proxy().stats.segmentsReplaced = 0;
      proxy().replaceAdSegments(input, streamInfo);
      expect(proxy().stats.segmentsReplaced).toBe(1);
    });
  });

  // ========== updateBaseline160pSegment ==========

  describe("updateBaseline160pSegment", () => {
    it("stores last live segment URL from clean playlist", () => {
      const streamInfo = {
        channelName: "test",
        last160pSegment: null,
      };

      proxy().updateBaseline160pSegment(CLEAN_MEDIA_PLAYLIST, streamInfo);
      expect(streamInfo.last160pSegment).toBe(
        "https://video-weaver.lax01.hls.ttvnw.net/v1/segment/source/seg-43.ts"
      );
    });

    it("does not update from ad playlist", () => {
      const streamInfo = {
        channelName: "test",
        last160pSegment: "https://old-segment.ts",
      };

      proxy().updateBaseline160pSegment(AD_MEDIA_PLAYLIST, streamInfo);
      expect(streamInfo.last160pSegment).toBe("https://old-segment.ts");
    });
  });

  // ========== findStreamInfoByUrl ==========

  describe("findStreamInfoByUrl", () => {
    it("finds stream info by matching resolution URL", () => {
      const resolutions = new Map();
      resolutions.set(
        "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8",
        { resolution: "1920x1080", bandwidth: 6000000 }
      );
      proxy().streamInfos.set("test", {
        channelName: "test",
        resolutions,
      });

      const result = proxy().findStreamInfoByUrl(
        "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8"
      );
      expect(result).toBeTruthy();
      expect(result.channelName).toBe("test");
    });

    it("returns null when no match found", () => {
      const result = proxy().findStreamInfoByUrl(
        "https://unknown-url.com/test.m3u8"
      );
      expect(result).toBeNull();
    });
  });

  // ========== getMatchingStreamUrl ==========

  describe("getMatchingStreamUrl", () => {
    it("finds best matching stream URL by resolution", () => {
      const streamInfo = {
        channelName: "test",
        resolutions: new Map([
          [
            "https://original/source.m3u8",
            {
              resolution: "1920x1080",
              bandwidth: 6000000,
              codecs: "avc1.64002A",
              frameRate: 60,
            },
          ],
        ]),
      };

      const backupEncodings = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6100000,RESOLUTION=1920x1080,CODECS="avc1.64002A",FRAME-RATE=60.000
https://backup/source.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F",FRAME-RATE=30.000
https://backup/720p.m3u8`;

      const result = proxy().getMatchingStreamUrl(
        backupEncodings,
        "https://original/source.m3u8",
        streamInfo
      );
      expect(result).toBe("https://backup/source.m3u8");
    });

    it("returns null when original URL not in resolutions", () => {
      const streamInfo = {
        channelName: "test",
        resolutions: new Map(),
      };

      const result = proxy().getMatchingStreamUrl(
        MASTER_PLAYLIST,
        "https://unknown/url.m3u8",
        streamInfo
      );
      expect(result).toBeNull();
    });
  });

  // ========== buildUsherUrl ==========

  describe("buildUsherUrl", () => {
    it("builds usher URL with token and strips tracking params", () => {
      const streamInfo = {
        channelName: "test",
        usherParams: "?allow_source=true&parent_domains=example.com",
      };
      const accessToken = {
        signature: "test-sig",
        value: '{"token": "value"}',
      };

      const result = proxy().buildUsherUrl(streamInfo, accessToken);

      expect(result).toContain("usher.ttvnw.net/api/channel/hls/test.m3u8");
      expect(result).toContain("sig=test-sig");
      expect(result).toContain("token=");
      expect(result).not.toContain("parent_domains=");
      expect(result).not.toContain("referrer=");
    });
  });

  // ========== isRetryableError ==========

  describe("isRetryableError", () => {
    it("returns true for ECONNRESET", () => {
      const err = new Error("fail");
      (err as any).cause = { code: "ECONNRESET" };
      expect(proxy().isRetryableError(err)).toBe(true);
    });

    it("returns true for ETIMEDOUT", () => {
      const err = new Error("fail");
      (err as any).code = "ETIMEDOUT";
      expect(proxy().isRetryableError(err)).toBe(true);
    });

    it("returns false for AbortError", () => {
      const err = new Error("abort");
      err.name = "AbortError";
      expect(proxy().isRetryableError(err)).toBe(false);
    });

    it("returns true for network-related error messages", () => {
      expect(proxy().isRetryableError(new Error("fetch failed"))).toBe(true);
      expect(proxy().isRetryableError(new Error("network error"))).toBe(true);
      expect(proxy().isRetryableError(new Error("SSL handshake failed"))).toBe(true);
    });

    it("returns false for non-Error values", () => {
      expect(proxy().isRetryableError("string error")).toBe(false);
      expect(proxy().isRetryableError(null)).toBe(false);
    });

    it("returns false for generic errors", () => {
      expect(proxy().isRetryableError(new Error("syntax error"))).toBe(false);
    });
  });

  // ========== processManifest (integration) ==========

  describe("processManifest", () => {
    it("routes master playlist through processMasterPlaylist", async () => {
      const url =
        "https://usher.ttvnw.net/api/channel/hls/test.m3u8?allow_source=true";
      const result = await proxy().processManifest(url, MASTER_PLAYLIST);

      expect(result).toBe(MASTER_PLAYLIST);
      expect(proxy().streamInfos.has("test")).toBe(true);
    });

    it("routes media playlist through processMediaPlaylist", async () => {
      const masterUrl =
        "https://usher.ttvnw.net/api/channel/hls/test.m3u8";
      proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);

      const mediaUrl =
        "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8";
      const result = await proxy().processManifest(
        mediaUrl,
        CLEAN_MEDIA_PLAYLIST
      );

      expect(result).toContain("#EXTM3U");
    });
  });

  // ========== processMediaPlaylist ==========

  describe("processMediaPlaylist", () => {
    it("returns text unchanged when no stream info found", async () => {
      const result = await proxy().processMediaPlaylist(
        "https://unknown-url.com/test.m3u8",
        CLEAN_MEDIA_PLAYLIST
      );
      expect(result).toBe(CLEAN_MEDIA_PLAYLIST);
    });

    it("increments adsDetected on ad detection", async () => {
      const masterUrl =
        "https://usher.ttvnw.net/api/channel/hls/test.m3u8";
      proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);

      const mediaUrl =
        "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8";

      fetchMock.mockRejectedValue(new Error("no backup"));

      await proxy().processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
      expect(proxy().stats.adsDetected).toBe(1);
    });

    it("sets isInAdBreak flag on ad detection", async () => {
      const masterUrl =
        "https://usher.ttvnw.net/api/channel/hls/test.m3u8";
      proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);

      const mediaUrl =
        "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8";

      fetchMock.mockRejectedValue(new Error("no backup"));

      await proxy().processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);

      const info = proxy().streamInfos.get("test");
      expect(info.isInAdBreak).toBe(true);
    });

    it("clears isInAdBreak when ad ends", async () => {
      const masterUrl =
        "https://usher.ttvnw.net/api/channel/hls/test.m3u8";
      proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);
      proxy().streamInfos.get("test").isInAdBreak = true;

      const mediaUrl =
        "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8";

      await proxy().processMediaPlaylist(mediaUrl, CLEAN_MEDIA_PLAYLIST);

      const info = proxy().streamInfos.get("test");
      expect(info.isInAdBreak).toBe(false);
    });

    it("neutralizes tracking URLs", async () => {
      const masterUrl =
        "https://usher.ttvnw.net/api/channel/hls/test.m3u8";
      proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);

      const mediaUrl =
        "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8";

      fetchMock.mockRejectedValue(new Error("no backup"));

      const result = await proxy().processMediaPlaylist(
        mediaUrl,
        AD_MEDIA_PLAYLIST
      );
      expect(result).not.toContain("tracking.twitch.tv");
    });
  });

  // ========== registerInterceptor ==========

  describe("registerInterceptor", () => {
    it("sets isRegistered to true", () => {
      twitchManifestProxy.registerInterceptor();
      expect(proxy().isRegistered).toBe(true);
    });

    it("does not double-register", () => {
      proxy().isRegistered = false;
      twitchManifestProxy.registerInterceptor();
      expect(proxy().isRegistered).toBe(true);

      twitchManifestProxy.registerInterceptor();
      expect(proxy().isRegistered).toBe(true);
    });
  });
});
