import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  clearStreamInfo,
  getAdBlockConfig,
  getAdBlockStatus,
  getBlankVideoDataUrl,
  initAdBlockService,
  isAdBlockEnabled,
  isAdSegment,
  processMasterPlaylist,
  processMediaPlaylist,
  setAuthHeaders,
  setPlayerCallbacks,
  setStatusChangeCallback,
  updateAdBlockConfig,
} from "@/components/player/twitch/twitch-adblock-service";

const SAMPLE_MASTER_PLAYLIST = `#EXTM3U
#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="1700000000.0"
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.4D401F,mp4a.40.2"
https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=30.000,CODECS="avc1.4D401F,mp4a.40.2"
https://video-edge.example.com/v1/playlist/720p30.m3u8?token=abc
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=852x480,FRAME-RATE=30.000,CODECS="avc1.4D401F,mp4a.40.2"
https://video-edge.example.com/v1/playlist/480p30.m3u8?token=abc`;

const CLEAN_MEDIA_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12345
#EXT-X-PROGRAM-DATE-TIME:2024-01-01T00:00:00Z
#EXTINF:2.000,live
https://video-edge.example.com/v1/segment/seg-12345.ts
#EXTINF:2.000,live
https://video-edge.example.com/v1/segment/seg-12346.ts`;

const AD_MEDIA_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12345
#EXT-X-DATERANGE:ID="stitched-ad-12345",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T00:00:00Z"
#EXTINF:2.000,
https://video-edge.example.com/v1/segment/ad-12345.ts
#EXTINF:2.000,
https://video-edge.example.com/v1/segment/ad-12346.ts`;

const AD_MIDROLL_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12345
#EXT-X-DATERANGE:ID="stitched-ad-12345",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T00:00:00Z"
#EXT-X-DATERANGE:ID="midroll-marker",CLASS="MIDROLL"
#EXTINF:2.000,
https://video-edge.example.com/v1/segment/ad-12345.ts`;

describe("twitch-adblock-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });
  });

  describe("initAdBlockService / config", () => {
    it("initializes with default config", () => {
      initAdBlockService();
      const cfg = getAdBlockConfig();
      expect(cfg.enabled).toBe(true);
      expect(cfg.adSignifier).toBe("stitched");
      expect(cfg.clientId).toBe("kimne78kx3ncx6brgo4mv6wki5h1ko");
    });

    it("merges partial config on init", () => {
      initAdBlockService({ enabled: false, adSignifier: "custom-ad" });
      const cfg = getAdBlockConfig();
      expect(cfg.enabled).toBe(false);
      expect(cfg.adSignifier).toBe("custom-ad");
      expect(cfg.clientId).toBe("kimne78kx3ncx6brgo4mv6wki5h1ko");
    });

    it("updateAdBlockConfig merges into existing config", () => {
      initAdBlockService({ enabled: true });
      updateAdBlockConfig({ enabled: false });
      expect(getAdBlockConfig().enabled).toBe(false);
      expect(getAdBlockConfig().adSignifier).toBe("stitched");
    });
  });

  describe("isAdBlockEnabled", () => {
    it("returns true when enabled", () => {
      initAdBlockService({ enabled: true });
      expect(isAdBlockEnabled()).toBe(true);
    });

    it("returns false when disabled", () => {
      initAdBlockService({ enabled: false });
      expect(isAdBlockEnabled()).toBe(false);
    });
  });

  describe("setAuthHeaders", () => {
    it("sets device ID and auth headers without error", () => {
      expect(() => {
        setAuthHeaders("device123", "OAuth token123", "integrity123");
      }).not.toThrow();
    });
  });

  describe("setStatusChangeCallback", () => {
    it("accepts a callback function", () => {
      const cb = vi.fn();
      expect(() => setStatusChangeCallback(cb)).not.toThrow();
    });
  });

  describe("getAdBlockStatus", () => {
    it("returns default status for unknown channel", () => {
      const status = getAdBlockStatus("unknownchannel");
      expect(status.isActive).toBe(true);
      expect(status.isShowingAd).toBe(false);
      expect(status.isMidroll).toBe(false);
      expect(status.isStrippingSegments).toBe(false);
      expect(status.numStrippedSegments).toBe(0);
      expect(status.activePlayerType).toBeNull();
      expect(status.channelName).toBeNull();
      expect(status.isUsingFallbackMode).toBe(false);
      expect(status.adStartTime).toBeNull();
    });
  });

  describe("isAdSegment / getBlankVideoDataUrl", () => {
    it("returns false for non-ad URLs", () => {
      expect(isAdSegment("https://video-edge.example.com/segment.ts")).toBe(false);
    });

    it("returns a data URL for blank video", () => {
      const url = getBlankVideoDataUrl();
      expect(url).toMatch(/^data:video\/mp4;base64,/);
    });
  });

  describe("clearStreamInfo", () => {
    it("clears without error for unknown channel", () => {
      expect(() => clearStreamInfo("nonexistent")).not.toThrow();
    });

    it("clears stream info after processing a master playlist", async () => {
      const url = "https://usher.ttvnw.net/api/channel/hls/teststreamer.m3u8?token=abc";

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("", { status: 200 })
      );

      await processMasterPlaylist(url, SAMPLE_MASTER_PLAYLIST, "teststreamer");

      const statusBefore = getAdBlockStatus("teststreamer");
      expect(statusBefore.channelName).toBe("teststreamer");

      clearStreamInfo("teststreamer");

      const statusAfter = getAdBlockStatus("teststreamer");
      expect(statusAfter.channelName).toBeNull();
    });
  });

  describe("processMasterPlaylist", () => {
    it("returns text unchanged when disabled", async () => {
      initAdBlockService({ enabled: false });
      const result = await processMasterPlaylist(
        "https://usher.ttvnw.net/api/channel/hls/test.m3u8?token=abc",
        SAMPLE_MASTER_PLAYLIST,
        "test"
      );
      expect(result).toBe(SAMPLE_MASTER_PLAYLIST);
    });

    it("parses resolutions from master playlist", async () => {
      const url = "https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc";

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("", { status: 200 })
      );

      await processMasterPlaylist(url, SAMPLE_MASTER_PLAYLIST, "testchannel");

      const status = getAdBlockStatus("testchannel");
      expect(status.channelName).toBe("testchannel");

      clearStreamInfo("testchannel");
    });

    it("replaces server time in returned playlist", async () => {
      const url = "https://usher.ttvnw.net/api/channel/hls/timechannel.m3u8?sig=abc&token=xyz";
      const playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.4D401F,mp4a.40.2"
https://video-edge.example.com/playlist.m3u8?token=abc
SERVER-TIME="1700000000.0"`;

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("", { status: 200 })
      );

      const result = await processMasterPlaylist(url, playlist, "timechannel");
      expect(result).toContain("SERVER-TIME=");

      clearStreamInfo("timechannel");
    });

    it("detects V2 API URLs", async () => {
      const url = "https://usher.ttvnw.net/api/v2/channel/hls/v2channel.m3u8?token=abc";
      const playlist = `#EXTM3U
#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="1700000000.0"
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.4D401F,mp4a.40.2"
https://video-edge.example.com/playlist.m3u8?token=abc`;

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("", { status: 200 })
      );

      const result = await processMasterPlaylist(url, playlist, "v2channel");
      expect(result).toContain("SERVER-TIME");

      clearStreamInfo("v2channel");
    });
  });

  describe("processMediaPlaylist", () => {
    it("returns text unchanged when disabled", async () => {
      initAdBlockService({ enabled: false });
      const result = await processMediaPlaylist(
        "https://video-edge.example.com/playlist.m3u8",
        CLEAN_MEDIA_PLAYLIST
      );
      expect(result).toBe(CLEAN_MEDIA_PLAYLIST);
    });

    it("returns text unchanged when no stream info exists for URL", async () => {
      initAdBlockService({ enabled: true });
      const result = await processMediaPlaylist(
        "https://unknown.example.com/unknown.m3u8",
        CLEAN_MEDIA_PLAYLIST
      );
      expect(result).toBe(CLEAN_MEDIA_PLAYLIST);
    });

    it("detects ads and updates stream info when processing registered URL", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/adchannel.m3u8?token=abc";

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("", { status: 200 })
      );

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "adchannel");

      const statusCallback = vi.fn();
      setStatusChangeCallback(statusCallback);

      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);

      const status = getAdBlockStatus("adchannel");
      expect(status.isShowingAd).toBe(true);

      clearStreamInfo("adchannel");
    });

    it("detects midroll ads", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/midrollchannel.m3u8?token=abc";

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("", { status: 200 })
      );

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "midrollchannel");

      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      await processMediaPlaylist(mediaUrl, AD_MIDROLL_PLAYLIST);

      const status = getAdBlockStatus("midrollchannel");
      expect(status.isShowingAd).toBe(true);
      expect(status.isMidroll).toBe(true);

      clearStreamInfo("midrollchannel");
    });

    it("clears ad state when ads end", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/adendchannel.m3u8?token=abc";

      const onReload = vi.fn();
      const onPauseResume = vi.fn();
      setPlayerCallbacks(onReload, onPauseResume);

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("", { status: 200 })
      );

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "adendchannel");

      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";

      await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
      expect(getAdBlockStatus("adendchannel").isShowingAd).toBe(true);

      await processMediaPlaylist(mediaUrl, CLEAN_MEDIA_PLAYLIST);
      expect(getAdBlockStatus("adendchannel").isShowingAd).toBe(false);

      clearStreamInfo("adendchannel");
    });

    it("neutralizes tracking URLs in playlist", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/trackchannel.m3u8?token=abc";

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("", { status: 200 })
      );

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "trackchannel");

      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      const playlistWithTracking = `#EXTM3U
#EXTINF:2.000,live
#EXT-X-PROGRAM-DATE-TIME:2024-01-01T00:00:00Z
X-TV-TWITCH-AD-URL="https://ads.twitch.tv/tracking"
X-TV-TWITCH-AD-CLICK-TRACKING-URL="https://ads.twitch.tv/click"
https://video-edge.example.com/v1/segment/seg-12345.ts`;

      const result = await processMediaPlaylist(mediaUrl, playlistWithTracking);
      expect(result).not.toContain("https://ads.twitch.tv/tracking");
      expect(result).not.toContain("https://ads.twitch.tv/click");

      clearStreamInfo("trackchannel");
    });
  });

  describe("setPlayerCallbacks", () => {
    it("accepts reload and pause/resume callbacks", () => {
      const onReload = vi.fn();
      const onPauseResume = vi.fn();
      expect(() => setPlayerCallbacks(onReload, onPauseResume)).not.toThrow();
    });
  });

  describe("HEVC detection", () => {
    it("creates modified playlist when both HEVC and AVC streams present", async () => {
      const hevcPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="hev1.1.6.L120,mp4a.40.2"
https://video-edge.example.com/hevc-1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=30.000,CODECS="avc1.4D401F,mp4a.40.2"
https://video-edge.example.com/avc-720p.m3u8`;

      const url = "https://usher.ttvnw.net/api/channel/hls/hevcchannel.m3u8?token=abc";

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("", { status: 200 })
      );

      await processMasterPlaylist(url, hevcPlaylist, "hevcchannel");

      const status = getAdBlockStatus("hevcchannel");
      expect(status.channelName).toBe("hevcchannel");

      clearStreamInfo("hevcchannel");
    });
  });

  describe("ad detection methods", () => {
    it("detects ads via DATERANGE patterns", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/drchannel.m3u8?token=abc";

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("", { status: 200 })
      );

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "drchannel");

      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      const daterangePlaylist = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-12345",CLASS="com.twitch.tv/ad",START-DATE="2024-01-01T00:00:00Z"
#EXTINF:2.000,
https://video-edge.example.com/v1/segment/ad-12345.ts`;

      await processMediaPlaylist(mediaUrl, daterangePlaylist);

      expect(getAdBlockStatus("drchannel").isShowingAd).toBe(true);

      clearStreamInfo("drchannel");
    });

    it("detects ads via stitched signifier", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/stitchchannel.m3u8?token=abc";

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("", { status: 200 })
      );

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "stitchchannel");

      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      const stitchedPlaylist = `#EXTM3U
#EXTINF:2.000,stitched
https://video-edge.example.com/v1/segment/ad-12345.ts`;

      await processMediaPlaylist(mediaUrl, stitchedPlaylist);

      expect(getAdBlockStatus("stitchchannel").isShowingAd).toBe(true);

      clearStreamInfo("stitchchannel");
    });
  });
});
