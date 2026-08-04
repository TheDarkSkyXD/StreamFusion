import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

vi.mock("@/backend/logging/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/services/vaft-pattern-service", () => ({
  vaftPatternService: {
    getDateRangePatterns: vi.fn(() => ["stitched-ad", "com.twitch.tv/ad", "amazon-ad"]),
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
import { logger } from "@/backend/logging/logger";

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

const CUE_AD_MEDIA_PLAYLIST = readFileSync(
  resolve(__dirname, "../../adblock/fixtures/twitch-playlists/ad-cue-out.m3u8"),
  "utf8"
);

// ========== Helper to access private methods ==========

function proxy(): any {
  return twitchManifestProxy;
}

// Guards: the main-process proxy uses shared structured detection for non-DATERANGE ad markers.
// Guards: playlist diagnostics never expose captured URLs, paths, tokens, or channel identity.
// Guards: active media processing never awaits channel-wide backup work or repeats recovery fanout inside its retry window.
describe("TwitchManifestProxyService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      const result = proxy().extractChannelName("https://usher.ttvnw.net/api/channel/hls/XQC.m3u8");
      expect(result).toBe("xqc");
    });

    it("extracts channel name from current usher URL shape", () => {
      const result = proxy().extractChannelName(
        "https://usher.ttvnw.net/api/channel/JamiePineLive.m3u8?allow_source=true"
      );
      expect(result).toBe("jamiepinelive");
    });

    it("returns null for non-matching URL", () => {
      const result = proxy().extractChannelName("https://example.com/video.mp4");
      expect(result).toBeNull();
    });
  });

  // ========== isMasterPlaylist ==========

  describe("isMasterPlaylist", () => {
    it("returns true for usher URLs", () => {
      expect(proxy().isMasterPlaylist("https://usher.ttvnw.net/api/channel/hls/test.m3u8")).toBe(
        true
      );
    });

    it("returns false for video-weaver URLs", () => {
      expect(
        proxy().isMasterPlaylist("https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8")
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
      const url = "https://usher.ttvnw.net/api/channel/hls/teststreamer.m3u8?allow_source=true";
      proxy().processMasterPlaylist(url, MASTER_PLAYLIST);

      expect(proxy().streamInfos.has("teststreamer")).toBe(true);
      const info = proxy().streamInfos.get("teststreamer");
      expect(info.resolutions.size).toBe(3);
      expect(info.channelName).toBe("teststreamer");
    });

    it("clears stale rendition and detector state when a master is replaced", () => {
      const url = "https://usher.ttvnw.net/api/channel/hls/resetstream.m3u8";
      proxy().processMasterPlaylist(url, MASTER_PLAYLIST);
      const first = proxy().streamInfos.get("resetstream");
      first.detectionScopes.add("resetstream:stale");
      first.candidateStates.set("resetstream:stale", {
        candidatePromise: null,
        readyCandidate: { playlist: "stale" },
        consecutiveMisses: 0,
        nextRetryAt: 0,
      });

      proxy().processMasterPlaylist(url, MASTER_PLAYLIST.replace("6000000", "6200000"));
      const replacement = proxy().streamInfos.get("resetstream");

      expect(replacement).not.toBe(first);
      expect(replacement.detectionScopes).toEqual(new Set());
      expect(replacement.candidateStates).toEqual(new Map());
    });

    it("stores usher params", () => {
      const url = "https://usher.ttvnw.net/api/channel/hls/test.m3u8?allow_source=true&token=abc";
      proxy().processMasterPlaylist(url, MASTER_PLAYLIST);

      const info = proxy().streamInfos.get("test");
      expect(info.usherParams).toContain("allow_source=true");
    });

    it("returns unmodified text", () => {
      const url = "https://usher.ttvnw.net/api/channel/hls/test.m3u8";
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

  // ========== neutralizeTrackingUrls ==========

  describe("neutralizeTrackingUrls", () => {
    it("replaces ad URL with safe URL", () => {
      const input = 'X-TV-TWITCH-AD-URL="https://tracking.twitch.tv/ad/click"';
      const result = proxy().neutralizeTrackingUrls(input);
      expect(result).toContain("https://twitch.tv");
      expect(result).not.toContain("tracking.twitch.tv");
    });

    it("replaces click tracking URL", () => {
      const input = 'X-TV-TWITCH-AD-CLICK-TRACKING-URL="https://tracking.twitch.tv/track"';
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

  // ========== findStreamInfoByUrl ==========

  describe("findStreamInfoByUrl", () => {
    it("finds stream info by matching resolution URL", () => {
      const resolutions = new Map();
      resolutions.set("https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8", {
        resolution: "1920x1080",
        bandwidth: 6000000,
      });
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
      const result = proxy().findStreamInfoByUrl("https://unknown-url.com/test.m3u8");
      expect(result).toBeNull();
    });
  });

  describe("backup preparation", () => {
    it("rejects lower renditions when the exact candidate contains ads", async () => {
      const originalUrl = "https://original/source.m3u8";
      const streamInfo = {
        channelName: "test",
        resolutions: new Map([
          [
            originalUrl,
            {
              resolution: "1920x1080",
              bandwidth: 6_000_000,
              codecs: "avc1.64002A",
              frameRate: 60,
            },
          ],
        ]),
        detectionScopes: new Set(),
        backupMastersPromise: null,
        prewarmPromises: new Map(),
        prewarmedCandidates: new Map(),
        servedBackups: new Map(),
      };
      const backupMaster = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6100000,RESOLUTION=1920x1080,CODECS="avc1.64002A",FRAME-RATE=60.000
https://backup/1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F",FRAME-RATE=60.000
https://backup/720p.m3u8`;
      vi.spyOn(proxy(), "fetchWithRetry").mockImplementation(async (url) => ({
        ok: true,
        text: async () =>
          typeof url === "string" && url.includes("1080p")
            ? `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:42
#EXT-X-CUE-OUT:30
#EXTINF:2.000,
https://backup/exact-42.ts`
            : `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:42
#EXTINF:2.000,live
https://backup/fallback-42.ts`,
      }));

      const result = await proxy().prepareCleanBackup(streamInfo, originalUrl, AD_MEDIA_PLAYLIST, [
        { playerType: "embed", playlist: backupMaster },
      ]);

      expect(result).toBeNull();
      expect(proxy().fetchWithRetry).not.toHaveBeenCalledWith("https://backup/720p.m3u8");
    });

    it("uses a ready aligned prewarmed exact candidate without refetching", async () => {
      const originalUrl = "https://original/source.m3u8";
      const candidate = {
        playerType: "popout",
        rendition: {
          url: "https://backup/source.m3u8",
          resolution: "1920x1080",
          bandwidth: 6_000_000,
          codecs: "avc1.64002A",
          frameRate: 60,
        },
        playlist: `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:42
#EXTINF:2.000,live
https://backup/live-42.ts`,
      };
      const streamInfo = {
        channelName: "test",
        resolutions: new Map([[originalUrl, candidate.rendition]]),
        candidateStates: new Map(),
        servedBackups: new Map(),
      };
      const scope = proxy().getDetectionScope(streamInfo, originalUrl);
      streamInfo.candidateStates.set(scope, {
        candidatePromise: null,
        readyCandidate: candidate,
        consecutiveMisses: 0,
        nextRetryAt: 0,
      });
      const prepareSpy = vi.spyOn(proxy(), "prepareCleanBackup");

      const result = await proxy().tryGetBackupStream(streamInfo, originalUrl, AD_MEDIA_PLAYLIST);

      expect(result).toBe(candidate.playlist);
      expect(prepareSpy).not.toHaveBeenCalled();
      expect(streamInfo.servedBackups.get(scope)).toBe(candidate);
    });

    it("does not share a ready AVC candidate with a same-size HEVC rendition", async () => {
      const avcUrl = "https://original/avc.m3u8";
      const hevcUrl = "https://original/hevc.m3u8";
      const avcResolution = {
        resolution: "1920x1080",
        bandwidth: 6_000_000,
        codecs: "avc1.64002A,mp4a.40.2",
        frameRate: 60,
      };
      const streamInfo = {
        channelName: "codec-test",
        resolutions: new Map([
          [avcUrl, avcResolution],
          [
            hevcUrl,
            {
              resolution: "1920x1080",
              bandwidth: 7_200_000,
              codecs: "hvc1.1.6.L120.B0,mp4a.40.2",
              frameRate: 60,
            },
          ],
        ]),
        candidateStates: new Map(),
        servedBackups: new Map(),
        backupMastersPromise: new Promise(() => undefined),
      };
      const avcScope = proxy().getDetectionScope(streamInfo, avcUrl);
      const candidate = {
        playerType: "popout",
        rendition: { ...avcResolution, url: "https://backup/avc.m3u8" },
        playlist: `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:42
#EXTINF:2.000,live
https://backup/avc-42.ts`,
      };
      streamInfo.candidateStates.set(avcScope, {
        candidatePromise: null,
        readyCandidate: candidate,
        consecutiveMisses: 0,
        nextRetryAt: 0,
      });

      expect(proxy().getDetectionScope(streamInfo, hevcUrl)).not.toBe(avcScope);
      await expect(
        proxy().tryGetBackupStream(streamInfo, hevcUrl, AD_MEDIA_PLAYLIST)
      ).resolves.toBe(null);
      expect(streamInfo.servedBackups.size).toBe(0);
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
      const url = "https://usher.ttvnw.net/api/channel/hls/test.m3u8?allow_source=true";
      const result = await proxy().processManifest(url, MASTER_PLAYLIST);

      expect(result).toBe(MASTER_PLAYLIST);
      expect(proxy().streamInfos.has("test")).toBe(true);
    });

    it("routes media playlist through processMediaPlaylist", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/test.m3u8";
      proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);

      const mediaUrl = "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8";
      const result = await proxy().processManifest(mediaUrl, CLEAN_MEDIA_PLAYLIST);

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

    it("keeps backup recovery idle until the first routed ad playlist", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/lazyproxy.m3u8";
      const mediaUrl = "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8";
      const loadSpy = vi.spyOn(proxy(), "loadBackupMasters").mockResolvedValue([]);

      proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);
      await proxy().processMediaPlaylist(mediaUrl, CLEAN_MEDIA_PLAYLIST);

      expect(loadSpy).not.toHaveBeenCalled();

      await proxy().processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
      expect(loadSpy).toHaveBeenCalledTimes(1);
    });

    it("retries an empty backup-master lookup after backoff and recovers a clean candidate", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/retryproxy.m3u8";
      const mediaUrl = "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8";
      const backupMaster = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6100000,RESOLUTION=1920x1080,CODECS="avc1.64002A",FRAME-RATE=60.000
https://backup.example/source.m3u8`;
      const loadSpy = vi
        .spyOn(proxy(), "loadBackupMasters")
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ playerType: "embed", playlist: backupMaster }]);
      vi.spyOn(proxy(), "fetchWithRetry").mockResolvedValue({
        ok: true,
        text: async () => CLEAN_MEDIA_PLAYLIST.replaceAll("video-weaver.lax01", "backup"),
      });

      try {
        proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);
        await proxy().processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
        for (let index = 0; index < 10; index += 1) await Promise.resolve();
        expect(loadSpy).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(2_000);
        await proxy().processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
        for (let index = 0; index < 20; index += 1) await Promise.resolve();

        expect(loadSpy).toHaveBeenCalledTimes(2);
        await expect(proxy().processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST)).resolves.toContain(
          "backup.hls.ttvnw.net/v1/segment/source/seg-42.ts"
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("returns an active ad playlist while unrelated backup preparation is pending", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/nonblocking.m3u8";
      const mediaUrl = "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8";
      let releaseBackupMasters!: (masters: unknown[]) => void;
      let backupMastersReleased = false;
      const backupGate = new Promise<unknown[]>((resolve) => {
        releaseBackupMasters = resolve;
      });
      const loadSpy = vi.spyOn(proxy(), "loadBackupMasters").mockReturnValue(backupGate);
      const candidateFetchSpy = vi.spyOn(proxy(), "fetchWithRetry").mockResolvedValue({
        ok: true,
        text: async () => AD_MEDIA_PLAYLIST,
      });

      proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);
      const firstResult = proxy().processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);

      try {
        let outcome: { state: "pending" | "resolved"; playlist: string } = {
          state: "pending",
          playlist: "",
        };
        void firstResult.then((playlist: string) => {
          outcome = { state: "resolved", playlist };
        });

        for (let index = 0; index < 10 && outcome.state === "pending"; index += 1) {
          await Promise.resolve();
        }

        expect(outcome.state).toBe("resolved");
        expect(outcome.playlist).toContain("ad/segment-1.ts");
        const loadsAfterFirstPlaylist = loadSpy.mock.calls.length;

        await expect(proxy().processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST)).resolves.toContain(
          "ad/segment-1.ts"
        );
        expect(loadSpy).toHaveBeenCalledTimes(loadsAfterFirstPlaylist);

        releaseBackupMasters([
          {
            playerType: "embed",
            playlist: `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6100000,RESOLUTION=1920x1080,CODECS="avc1.64002A",FRAME-RATE=60.000
https://backup.example/source.m3u8`,
          },
        ]);
        backupMastersReleased = true;
        await vi.waitFor(() => expect(candidateFetchSpy).toHaveBeenCalledTimes(1));
        for (let index = 0; index < 10; index += 1) await Promise.resolve();
        const candidateRequestsAfterMiss = candidateFetchSpy.mock.calls.length;

        await proxy().processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
        for (let index = 0; index < 10; index += 1) await Promise.resolve();
        expect(candidateFetchSpy).toHaveBeenCalledTimes(candidateRequestsAfterMiss);
      } finally {
        if (!backupMastersReleased) releaseBackupMasters([]);
        await firstResult;
      }
    });

    it("increments adsDetected on ad detection", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/test.m3u8";
      proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);

      const mediaUrl = "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8";

      fetchMock.mockRejectedValue(new Error("no backup"));

      await proxy().processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
      expect(proxy().stats.adsDetected).toBe(1);
    });

    it("passes through ad content when no clean aligned backup exists", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/passthrough.m3u8";
      const mediaUrl = "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8";
      proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);
      vi.spyOn(proxy(), "tryGetBackupStream").mockResolvedValueOnce(null);

      const result = await proxy().processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);

      expect(result).toContain("d2nvs31859zcd8.cloudfront.net/ad/segment-1.ts");
      expect(result).not.toContain("data:video/");
      expect(logger.debug).toHaveBeenCalledWith(
        "Service:TwitchManifest",
        "No clean aligned backup; passing through",
        expect.objectContaining({ outcome: "passthrough" })
      );
    });

    it("routes cue markers through shared playlist detection", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/test.m3u8";
      proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);
      fetchMock.mockRejectedValue(new Error("no backup"));

      await proxy().processMediaPlaylist(
        "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8",
        CUE_AD_MEDIA_PLAYLIST
      );

      expect(twitchManifestProxy.getStats().adsDetected).toBe(1);
      const diagnosticCall = vi
        .mocked(logger.debug)
        .mock.calls.find(([, message]) => message === "Playlist ad classification");
      const serializedDiagnostic = JSON.stringify(diagnosticCall?.[2]);

      expect(diagnosticCall?.[2]).toMatchObject({
        captureKind: "classification",
        verdict: "ad",
        reasons: expect.arrayContaining(["cue-out"]),
      });
      expect(serializedDiagnostic).not.toMatch(/neutral\.synthetic|cue-400|token=|test:/);
    });

    it("sets isInAdBreak flag on ad detection", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/test.m3u8";
      proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);

      const mediaUrl = "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8";

      fetchMock.mockRejectedValue(new Error("no backup"));

      await proxy().processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);

      const info = proxy().streamInfos.get("test");
      expect(info.isInAdBreak).toBe(true);
    });

    it("clears isInAdBreak when ad ends", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/test.m3u8";
      proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);
      proxy().streamInfos.get("test").isInAdBreak = true;

      const mediaUrl = "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8";

      await proxy().processMediaPlaylist(mediaUrl, CLEAN_MEDIA_PLAYLIST);

      const info = proxy().streamInfos.get("test");
      expect(info.isInAdBreak).toBe(false);
    });

    it("keeps ad state while the next playlist is only suspected", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/test.m3u8";
      const mediaUrl = "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8";
      const suspectedHostTransition = CLEAN_MEDIA_PLAYLIST.replaceAll(
        "video-weaver.lax01.hls.ttvnw.net",
        "alternate-weaver.synthetic.invalid"
      );
      proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);
      fetchMock.mockRejectedValue(new Error("no backup"));

      await proxy().processMediaPlaylist(mediaUrl, CLEAN_MEDIA_PLAYLIST);
      await proxy().processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
      await proxy().processMediaPlaylist(mediaUrl, suspectedHostTransition);

      const info = proxy().streamInfos.get("test");
      expect(info.isInAdBreak).toBe(true);
    });

    it("neutralizes tracking URLs", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/test.m3u8";
      proxy().processMasterPlaylist(masterUrl, MASTER_PLAYLIST);

      const mediaUrl = "https://video-weaver.lax01.hls.ttvnw.net/v1/playlist/source.m3u8";

      fetchMock.mockRejectedValue(new Error("no backup"));

      const result = await proxy().processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
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
