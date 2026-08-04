import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from "@/renderer/logging/logger";

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

const TWITCH_STITCHED_AMAZON_AD_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12345
#EXT-X-DATERANGE:ID="stitched-ad-12345",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T00:00:00Z",X-TV-TWITCH-AD-ROLL-TYPE="PREROLL"
#EXT-X-PROGRAM-DATE-TIME:2024-01-01T00:00:00Z
#EXTINF:2.000,Amazon|2474283100494
https://video-edge.example.com/v1/segment/amazon-ad-12345.ts
#EXT-X-TWITCH-PREFETCH:https://video-edge.example.com/v1/segment/prefetch-ad-12346.ts`;

const CUE_AD_MEDIA_PLAYLIST = readFileSync(
  resolve(__dirname, "../../../adblock/fixtures/twitch-playlists/ad-cue-out.m3u8"),
  "utf8"
);

// Guards: renderer-side detection uses the shared classifier for non-DATERANGE ad markers.
// Guards: renderer diagnostics never expose captured URLs, paths, tokens, or channel identity.
// Guards: background ad-segment consumption never interrupts playlist processing when fetch stubs return no value.
// Guards: backup recovery stays idle until ad detection and never blocks the live playlist.
// Guards: active ad playlists reach HLS without awaiting channel-wide backup work, while ad segments stay blocked and immediate refreshes reuse recovery work.
// Guards: leaving a clean backup refreshes HLS before the temporary rendition buffer drains.
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
      expect(cfg.skipPlayerReloadOnHevc).toBe(true);
      expect(cfg.reloadPlayerAfterAd).toBe(false);
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

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));

      await processMasterPlaylist(url, SAMPLE_MASTER_PLAYLIST, "teststreamer");

      const statusBefore = getAdBlockStatus("teststreamer");
      expect(statusBefore.channelName).toBe("teststreamer");

      clearStreamInfo("teststreamer");

      const statusAfter = getAdBlockStatus("teststreamer");
      expect(statusAfter.channelName).toBeNull();
    });
  });

  describe("master playlist startup", () => {
    it("keeps backup recovery idle until the first ad playlist", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/lazychannel.m3u8";
      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { streamPlaybackAccessToken: { signature: "sig", value: "{}" } },
          }),
          { status: 200 }
        )
      );

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "lazychannel");
      await processMediaPlaylist(mediaUrl, CLEAN_MEDIA_PLAYLIST);

      expect(fetchSpy).not.toHaveBeenCalled();

      await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
      await vi.waitFor(() =>
        expect(
          fetchSpy.mock.calls.filter(([input]) => String(input) === "https://gql.twitch.tv/gql")
        ).toHaveLength(5)
      );
      clearStreamInfo("lazychannel");
    });

    it("retries an empty backup-master lookup after backoff and recovers a clean candidate", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/retrychannel.m3u8";
      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      const backupMaster = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6100000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A"
https://backup.example/retry-1080p60.m3u8`;
      const cleanBackup = CLEAN_MEDIA_PLAYLIST.replaceAll(
        "video-edge.example.com",
        "backup.example"
      );
      let backupAvailable = false;
      let gqlRequests = 0;

      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const requestUrl = String(input);
        if (requestUrl === "https://gql.twitch.tv/gql") {
          gqlRequests += 1;
          return new Response(
            JSON.stringify({
              data: { streamPlaybackAccessToken: { signature: "sig", value: "{}" } },
            }),
            { status: 200 }
          );
        }
        if (requestUrl.includes("usher.ttvnw.net")) {
          return new Response(backupAvailable ? backupMaster : "", {
            status: backupAvailable ? 200 : 503,
          });
        }
        if (requestUrl === "https://backup.example/retry-1080p60.m3u8") {
          return new Response(cleanBackup, { status: 200 });
        }
        return new Response("", { status: 200 });
      });

      try {
        await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "retrychannel");
        await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
        for (let index = 0; index < 20; index += 1) await Promise.resolve();
        expect(gqlRequests).toBe(5);

        backupAvailable = true;
        await vi.advanceTimersByTimeAsync(2_000);
        await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
        for (let index = 0; index < 30; index += 1) await Promise.resolve();

        expect(gqlRequests).toBe(10);
        await expect(processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST)).resolves.toBe(cleanBackup);
      } finally {
        clearStreamInfo("retrychannel");
        vi.useRealTimers();
      }
    });

    it("clears global recovery state when a same-text master generation fails validation", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/restartchannel.m3u8";
      const restartMaster = SAMPLE_MASTER_PLAYLIST.replaceAll("?token=abc", "");
      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8";
      const backupMaster = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6100000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A"
https://backup.example/restart-1080p60.m3u8`;
      const cleanBackup = CLEAN_MEDIA_PLAYLIST.replaceAll(
        "video-edge.example.com",
        "backup.example"
      );
      let gqlRequests = 0;

      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const requestUrl = String(input);
        if (init?.method === "HEAD") return new Response("", { status: 503 });
        if (requestUrl === "https://gql.twitch.tv/gql") {
          gqlRequests += 1;
          return new Response(
            JSON.stringify({
              data: { streamPlaybackAccessToken: { signature: "sig", value: "{}" } },
            }),
            { status: 200 }
          );
        }
        if (requestUrl.includes("usher.ttvnw.net")) {
          return new Response(backupMaster, { status: 200 });
        }
        if (requestUrl === "https://backup.example/restart-1080p60.m3u8") {
          return new Response(cleanBackup, { status: 200 });
        }
        return new Response("", { status: 200 });
      });

      await processMasterPlaylist(masterUrl, restartMaster, "restartchannel");
      await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
      for (let index = 0; index < 30; index += 1) await Promise.resolve();
      expect(gqlRequests).toBe(5);

      await processMasterPlaylist(masterUrl, restartMaster, "restartchannel");
      await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
      for (let index = 0; index < 30; index += 1) await Promise.resolve();

      expect(gqlRequests).toBe(10);
      clearStreamInfo("restartchannel");
    });

    it("returns an active ad playlist while background backup recovery is pending", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/activechannel.m3u8";
      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      let releaseBackupRequests!: (response: Response) => void;
      let backupRequestsReleased = false;
      const backupGate = new Promise<Response>((resolve) => {
        releaseBackupRequests = resolve;
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const requestUrl = String(input);
        if (requestUrl === "https://gql.twitch.tv/gql") {
          return backupGate.then((response) => response.clone());
        }
        if (requestUrl.includes("usher.ttvnw.net")) {
          return new Response(
            `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6100000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A"
https://backup.example/active-1080p60.m3u8`,
            { status: 200 }
          );
        }
        if (requestUrl === "https://backup.example/active-1080p60.m3u8") {
          return new Response(AD_MEDIA_PLAYLIST, { status: 200 });
        }
        return new Response("", { status: 200 });
      });

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "activechannel");
      const firstResult = processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);

      try {
        let outcome: { state: "pending" | "resolved"; playlist: string } = {
          state: "pending",
          playlist: "",
        };
        void firstResult.then((playlist) => {
          outcome = { state: "resolved", playlist };
        });

        for (let index = 0; index < 10 && outcome.state === "pending"; index += 1) {
          await Promise.resolve();
        }

        expect(outcome.state).toBe("resolved");
        expect(outcome.playlist).toContain("ad-12345.ts");
        expect(isAdSegment("https://video-edge.example.com/v1/segment/ad-12345.ts")).toBe(true);
        const backupRequestsAfterFirstPlaylist = fetchSpy.mock.calls.filter(
          ([input]) => String(input) === "https://gql.twitch.tv/gql"
        ).length;

        await expect(processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST)).resolves.toContain(
          "ad-12345.ts"
        );
        expect(
          fetchSpy.mock.calls.filter(([input]) => String(input) === "https://gql.twitch.tv/gql")
        ).toHaveLength(backupRequestsAfterFirstPlaylist);

        releaseBackupRequests(
          new Response(
            JSON.stringify({
              data: { streamPlaybackAccessToken: { signature: "sig", value: "{}" } },
            }),
            { status: 200 }
          )
        );
        backupRequestsReleased = true;
        await vi.waitFor(() =>
          expect(
            fetchSpy.mock.calls.filter(
              ([input]) => String(input) === "https://backup.example/active-1080p60.m3u8"
            )
          ).toHaveLength(5)
        );
        for (let index = 0; index < 10; index += 1) await Promise.resolve();
        const candidateRequestsAfterMiss = fetchSpy.mock.calls.filter(
          ([input]) => String(input) === "https://backup.example/active-1080p60.m3u8"
        ).length;

        await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
        for (let index = 0; index < 10; index += 1) await Promise.resolve();
        expect(
          fetchSpy.mock.calls.filter(
            ([input]) => String(input) === "https://backup.example/active-1080p60.m3u8"
          )
        ).toHaveLength(candidateRequestsAfterMiss);
      } finally {
        if (!backupRequestsReleased) {
          releaseBackupRequests(
            new Response(
              JSON.stringify({
                data: { streamPlaybackAccessToken: { signature: "sig", value: "{}" } },
              }),
              { status: 200 }
            )
          );
        }
        await firstResult;
        clearStreamInfo("activechannel");
      }
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

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));

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

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));

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

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));

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

      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "adchannel");

      const statusCallback = vi.fn();
      setStatusChangeCallback(statusCallback);

      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);

      const status = getAdBlockStatus("adchannel");
      expect(status.isShowingAd).toBe(true);

      clearStreamInfo("adchannel");
    });

    it("continues processing when background ad-segment consumption returns no response", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/consumechannel.m3u8?token=abc";
      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      vi.spyOn(globalThis, "fetch").mockImplementation(
        (() => undefined) as unknown as typeof fetch
      );

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "consumechannel");

      await expect(processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST)).resolves.toBeDefined();
      expect(getAdBlockStatus("consumechannel").isShowingAd).toBe(true);

      clearStreamInfo("consumechannel");
    });

    it("does not substitute a lower rendition when an exact backup is absent", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/qualitychannel.m3u8";
      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      const backupMaster = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=60.000,CODECS="avc1.4D401F"
https://backup.example/720p60.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=852x480,FRAME-RATE=30.000,CODECS="avc1.4D401F"
https://backup.example/480p30.m3u8`;
      const cleanBackup = (quality: string) => `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:12345
#EXTINF:2.000,live
https://backup.example/${quality}/seg-12345.ts
#EXTINF:2.000,live
https://backup.example/${quality}/seg-12346.ts`;

      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const requestUrl = String(input);
        if (requestUrl === "https://gql.twitch.tv/gql") {
          return new Response(
            JSON.stringify({
              data: {
                streamPlaybackAccessToken: {
                  signature: "sig",
                  value: "{}",
                },
              },
            }),
            { status: 200 }
          );
        }
        if (requestUrl.includes("usher.ttvnw.net")) {
          return new Response(backupMaster, { status: 200 });
        }
        if (requestUrl.includes("backup.example/720p60.m3u8")) {
          return new Response(cleanBackup("720p60"), { status: 200 });
        }
        if (requestUrl.includes("backup.example/480p30.m3u8")) {
          return new Response(cleanBackup("480p30"), { status: 200 });
        }
        return new Response("", { status: 200 });
      });

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "qualitychannel");
      await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
      await vi.waitFor(() =>
        expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
          expect.stringContaining("usher.ttvnw.net/api/channel/hls/qualitychannel.m3u8"),
          expect.anything()
        )
      );
      for (let index = 0; index < 10; index += 1) await Promise.resolve();

      const result = await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);

      expect(result).not.toContain("backup.example/");
      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalledWith(
        "https://backup.example/720p60.m3u8",
        expect.anything()
      );
      expect(getAdBlockStatus("qualitychannel").isUsingFallbackMode).toBe(true);
      clearStreamInfo("qualitychannel");
    });

    it("uses stripping when the exact backup is unplayable", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/playablechannel.m3u8";
      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      const backupMaster = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6100000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A"
https://backup.example/empty-1080p60.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=60.000,CODECS="avc1.4D401F"
https://backup.example/live-720p60.m3u8`;
      const unplayableBackup = `#EXTM3U
#EXT-X-TARGETDURATION:5
#EXT-X-MEDIA-SEQUENCE:12345
#EXTINF:5.000,live`;
      const playableBackup = `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12345
#EXTINF:2.000,live
https://backup.example/720p60/seg-12345.ts`;
      const requestedUrls: string[] = [];

      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const requestUrl = String(input);
        requestedUrls.push(requestUrl);
        if (requestUrl === "https://gql.twitch.tv/gql") {
          return new Response(
            JSON.stringify({
              data: { streamPlaybackAccessToken: { signature: "sig", value: "{}" } },
            }),
            { status: 200 }
          );
        }
        if (requestUrl.includes("usher.ttvnw.net")) {
          return new Response(backupMaster, { status: 200 });
        }
        if (requestUrl === "https://backup.example/empty-1080p60.m3u8") {
          return new Response(unplayableBackup, { status: 200 });
        }
        if (requestUrl === "https://backup.example/live-720p60.m3u8") {
          return new Response(playableBackup, { status: 200 });
        }
        return new Response("", { status: 200 });
      });

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "playablechannel");
      await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
      await vi.waitFor(() =>
        expect(requestedUrls).toContain("https://backup.example/empty-1080p60.m3u8")
      );

      for (let index = 0; index < 10; index += 1) await Promise.resolve();
      const result = await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);

      expect(result).not.toContain("backup.example/");
      expect(requestedUrls).not.toContain("https://backup.example/live-720p60.m3u8");
      expect(getAdBlockStatus("playablechannel").isUsingFallbackMode).toBe(true);
      clearStreamInfo("playablechannel");
    });

    it("prepares and reuses an aligned exact-rendition backup after ad detection", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/prewarmchannel.m3u8";
      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      const onReload = vi.fn();
      setPlayerCallbacks(onReload, vi.fn());
      const backupMaster = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6100000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A"
https://backup.example/1080p60.m3u8`;
      const prewarmedPlaylist = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:12345
#EXTINF:2.000,live
https://backup.example/1080p60/seg-12345.ts
#EXTINF:2.000,live
https://backup.example/1080p60/seg-12346.ts`;
      const requestedUrls: string[] = [];

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const requestUrl = String(input);
        requestedUrls.push(requestUrl);
        if (requestUrl === "https://gql.twitch.tv/gql") {
          return new Response(
            JSON.stringify({
              data: { streamPlaybackAccessToken: { signature: "sig", value: "{}" } },
            }),
            { status: 200 }
          );
        }
        if (requestUrl.includes("usher.ttvnw.net")) {
          return new Response(backupMaster, { status: 200 });
        }
        if (requestUrl.includes("backup.example/1080p60.m3u8")) {
          return new Response(prewarmedPlaylist, { status: 200 });
        }
        return new Response("", { status: 200 });
      });

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "prewarmchannel");
      await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
      await vi.waitFor(() =>
        expect(requestedUrls).toContain("https://backup.example/1080p60.m3u8")
      );
      for (let index = 0; index < 10; index += 1) await Promise.resolve();

      fetchSpy.mockRejectedValue(new Error("network unavailable after prewarm"));
      const result = await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);

      expect(result).toBe(prewarmedPlaylist);
      const restored = await processMediaPlaylist(mediaUrl, CLEAN_MEDIA_PLAYLIST);
      expect(restored).toBe(CLEAN_MEDIA_PLAYLIST);
      expect(getAdBlockStatus("prewarmchannel").isShowingAd).toBe(false);
      expect(onReload).toHaveBeenCalledWith("ad-ended");
      clearStreamInfo("prewarmchannel");
    });

    it("does not reuse an AVC backup candidate for a same-size HEVC rendition", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/codecscopechannel.m3u8";
      const avcUrl = "https://video-edge.example.com/v1/playlist/avc.m3u8";
      const hevcUrl = "https://video-edge.example.com/v1/playlist/hevc.m3u8";
      const mixedCodecMaster = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A,mp4a.40.2"
${avcUrl}
#EXT-X-STREAM-INF:BANDWIDTH=7200000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="hvc1.1.6.L120.B0,mp4a.40.2"
${hevcUrl}`;
      const backupMaster = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A,mp4a.40.2"
https://backup.example/avc.m3u8`;
      const cleanAvcBackup = CLEAN_MEDIA_PLAYLIST.replaceAll(
        "video-edge.example.com",
        "backup.example"
      );

      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const requestUrl = String(input);
        if (requestUrl === "https://gql.twitch.tv/gql") {
          return new Response(
            JSON.stringify({
              data: { streamPlaybackAccessToken: { signature: "sig", value: "{}" } },
            }),
            { status: 200 }
          );
        }
        if (requestUrl.includes("usher.ttvnw.net")) {
          return new Response(backupMaster, { status: 200 });
        }
        if (requestUrl === "https://backup.example/avc.m3u8") {
          return new Response(cleanAvcBackup, { status: 200 });
        }
        return new Response("", { status: 200 });
      });

      await processMasterPlaylist(masterUrl, mixedCodecMaster, "codecscopechannel");
      await processMediaPlaylist(avcUrl, AD_MEDIA_PLAYLIST);
      for (let index = 0; index < 30; index += 1) await Promise.resolve();
      await expect(processMediaPlaylist(avcUrl, AD_MEDIA_PLAYLIST)).resolves.toBe(cleanAvcBackup);

      const firstHevcResult = await processMediaPlaylist(hevcUrl, AD_MEDIA_PLAYLIST);

      expect(firstHevcResult).toBe(AD_MEDIA_PLAYLIST);
      expect(firstHevcResult).not.toContain("backup.example/v1/segment");
      clearStreamInfo("codecscopechannel");
    });

    it("uses stripping when the exact backup is cue-marked", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/cuebackupchannel.m3u8";
      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      const backupMaster = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6100000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A"
https://backup.example/1080p60.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=60.000,CODECS="avc1.4D401F"
https://backup.example/720p60.m3u8`;
      const playlist = (quality: string, cue = false) => `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:12345
${cue ? "#EXT-X-CUE-OUT:30\n" : ""}#EXTINF:2.000,live
https://backup.example/${quality}/seg-12345.ts`;
      const requestedUrls: string[] = [];
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const requestUrl = String(input);
        requestedUrls.push(requestUrl);
        if (requestUrl === "https://gql.twitch.tv/gql") {
          return new Response(
            JSON.stringify({
              data: { streamPlaybackAccessToken: { signature: "sig", value: "{}" } },
            }),
            { status: 200 }
          );
        }
        if (requestUrl.includes("usher.ttvnw.net")) {
          return new Response(backupMaster, { status: 200 });
        }
        if (requestUrl.includes("backup.example/1080p60.m3u8")) {
          return new Response(playlist("1080p60", true), { status: 200 });
        }
        if (requestUrl.includes("backup.example/720p60.m3u8")) {
          return new Response(playlist("720p60"), { status: 200 });
        }
        return new Response("", { status: 200 });
      });

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "cuebackupchannel");
      await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
      await vi.waitFor(() =>
        expect(requestedUrls).toContain("https://backup.example/1080p60.m3u8")
      );
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
      fetchSpy.mockRejectedValue(new Error("network unavailable after prewarm"));
      const result = await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);

      expect(result).not.toContain("backup.example/");
      expect(requestedUrls).not.toContain("https://backup.example/720p60.m3u8");
      expect(getAdBlockStatus("cuebackupchannel").isUsingFallbackMode).toBe(true);
      clearStreamInfo("cuebackupchannel");
    });

    it("ranks exact candidates ahead of earlier player-type fallbacks", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/globalrankchannel.m3u8";
      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      const masterFor = (playerType: string) => {
        const exact = playerType === "popout";
        return `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=${exact ? 6_100_000 : 3_000_000},RESOLUTION=${exact ? "1920x1080" : "1280x720"},FRAME-RATE=60.000,CODECS="avc1.64002A"
https://backup.example/${playerType}-${exact ? "1080p60" : "720p60"}.m3u8`;
      };
      const requestedUrls: string[] = [];
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const requestUrl = String(input);
        requestedUrls.push(requestUrl);
        if (requestUrl === "https://gql.twitch.tv/gql") {
          const body = JSON.parse(String(init?.body)) as { variables: { playerType: string } };
          return new Response(
            JSON.stringify({
              data: {
                streamPlaybackAccessToken: {
                  signature: "sig",
                  value: JSON.stringify({ playerType: body.variables.playerType }),
                },
              },
            }),
            { status: 200 }
          );
        }
        if (requestUrl.includes("usher.ttvnw.net")) {
          const playerType = JSON.parse(new URL(requestUrl).searchParams.get("token") ?? "{}")
            .playerType as string;
          return new Response(masterFor(playerType), { status: 200 });
        }
        if (requestUrl.includes("backup.example/")) {
          return new Response(
            `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:12345
#EXTINF:2.000,live
${requestUrl.replace(".m3u8", "/seg-12345.ts")}`,
            { status: 200 }
          );
        }
        return new Response("", { status: 200 });
      });

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "globalrankchannel");
      await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
      await vi.waitFor(() =>
        expect(requestedUrls).toContain("https://backup.example/popout-1080p60.m3u8")
      );
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
      fetchSpy.mockRejectedValue(new Error("network unavailable after prewarm"));
      const result = await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);

      expect(result).toContain("popout-1080p60/seg-12345.ts");
      expect(result).not.toContain("embed-720p60/");
      clearStreamInfo("globalrankchannel");
    });

    it("passes through the original live playlist when no clean aligned backup exists", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/passthroughchannel.m3u8";
      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no clean backup"));

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "passthroughchannel");
      const result = await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);

      expect(result).toBe(AD_MEDIA_PLAYLIST);
      expect(result).not.toContain("data:video/");
      clearStreamInfo("passthroughchannel");
    });

    it("processes media playlist URLs when Twitch changes only the query string", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/querychannel.m3u8?token=abc";

      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "querychannel");

      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=refreshed";
      const result = await processMediaPlaylist(mediaUrl, TWITCH_STITCHED_AMAZON_AD_PLAYLIST);

      const status = getAdBlockStatus("querychannel");
      expect(status.isShowingAd).toBe(true);
      expect(status.isStrippingSegments).toBe(true);
      expect(isAdSegment("https://video-edge.example.com/v1/segment/amazon-ad-12345.ts")).toBe(
        true
      );
      expect(result).not.toContain("#EXT-X-TWITCH-PREFETCH:");

      clearStreamInfo("querychannel");
    });

    it("strips detected ad segments when only one active stream can own an unmapped media URL", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/fallbackchannel.m3u8?token=abc";

      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "fallbackchannel");

      const mediaUrl = "https://unmapped.example.com/v1/playlist/source.m3u8?token=unknown";
      const result = await processMediaPlaylist(mediaUrl, TWITCH_STITCHED_AMAZON_AD_PLAYLIST);

      const status = getAdBlockStatus("fallbackchannel");
      expect(status.isShowingAd).toBe(true);
      expect(status.isStrippingSegments).toBe(true);
      expect(isAdSegment("https://video-edge.example.com/v1/segment/amazon-ad-12345.ts")).toBe(
        true
      );
      expect(result).not.toContain("#EXT-X-TWITCH-PREFETCH:");

      clearStreamInfo("fallbackchannel");
    });

    it("detects midroll ads", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/midrollchannel.m3u8?token=abc";

      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

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

      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "adendchannel");

      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";

      await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
      expect(getAdBlockStatus("adendchannel").isShowingAd).toBe(true);

      await processMediaPlaylist(mediaUrl, CLEAN_MEDIA_PLAYLIST);
      expect(getAdBlockStatus("adendchannel").isShowingAd).toBe(false);
      expect(onReload).not.toHaveBeenCalled();
      expect(onPauseResume).not.toHaveBeenCalled();

      clearStreamInfo("adendchannel");
    });

    it("keeps active ad state while the next playlist is only suspected", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/suspectchannel.m3u8?token=abc";
      const mediaUrl = "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc";
      const suspectedHostTransition = CLEAN_MEDIA_PLAYLIST.replaceAll(
        "video-edge.example.com",
        "alternate-edge.example.com"
      );

      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "suspectchannel");
      await processMediaPlaylist(mediaUrl, CLEAN_MEDIA_PLAYLIST);
      await processMediaPlaylist(mediaUrl, AD_MEDIA_PLAYLIST);
      await processMediaPlaylist(mediaUrl, suspectedHostTransition);

      expect(getAdBlockStatus("suspectchannel").isShowingAd).toBe(true);
      clearStreamInfo("suspectchannel");
    });

    it("neutralizes tracking URLs in playlist", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/trackchannel.m3u8?token=abc";

      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

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

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));

      await processMasterPlaylist(url, hevcPlaylist, "hevcchannel");

      const status = getAdBlockStatus("hevcchannel");
      expect(status.channelName).toBe("hevcchannel");

      clearStreamInfo("hevcchannel");
    });
  });

  describe("ad detection methods", () => {
    it("routes cue markers through shared playlist detection", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/cuechannel.m3u8?token=abc";
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
      await processMasterPlaylist(masterUrl, SAMPLE_MASTER_PLAYLIST, "cuechannel");

      await processMediaPlaylist(
        "https://video-edge.example.com/v1/playlist/1080p60.m3u8?token=abc",
        CUE_AD_MEDIA_PLAYLIST
      );

      expect(getAdBlockStatus("cuechannel").isShowingAd).toBe(true);
      const diagnosticCall = vi
        .mocked(logger.debug)
        .mock.calls.find(([, message]) => message === "playlist ad classification");
      const serializedDiagnostic = JSON.stringify(diagnosticCall?.[2]);

      expect(diagnosticCall?.[2]).toMatchObject({
        captureKind: "classification",
        verdict: "ad",
        reasons: expect.arrayContaining(["cue-out"]),
      });
      expect(serializedDiagnostic).not.toMatch(/neutral\.synthetic|cue-400|token=|cuechannel/);
      clearStreamInfo("cuechannel");
    });

    it("detects ads via DATERANGE patterns", async () => {
      const masterUrl = "https://usher.ttvnw.net/api/channel/hls/drchannel.m3u8?token=abc";

      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

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

      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

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
