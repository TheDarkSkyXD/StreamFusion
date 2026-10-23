import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAdBlockStatus,
  initAdBlockService,
  processMasterPlaylist,
  processMediaPlaylist,
  resetTwitchAdBlockServiceForTests,
  waitForTwitchAdBlockServiceIdleForTests,
} from "@/features/playback/adapters/browser/twitch/twitch-adblock-service";

const masterUrl = "https://usher.ttvnw.net/api/channel/hls/primevideo.m3u8?cdm=wv";
const mediaUrl = "https://video-weaver.example.com/primevideo/chunked/index-dvr.m3u8";
const backupUrl = "https://video-weaver.example.com/primevideo/embed/chunked/index-dvr.m3u8";
const streamInfo =
  '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A,mp4a.40.2"';
const masterPlaylist = ["#EXTM3U", streamInfo, mediaUrl].join("\n");
const backupMasterPlaylist = ["#EXTM3U", streamInfo, backupUrl].join("\n");
const adCue =
  '#EXT-X-DATERANGE:ID="break-1",CLASS="twitch-stitched-ad",START-DATE="2026-10-22T12:00:00Z",DURATION=30';
const cleanOriginal = [
  "#EXTM3U",
  "#EXT-X-VERSION:7",
  "#EXT-X-TARGETDURATION:2",
  "#EXT-X-MEDIA-SEQUENCE:100",
  '#EXT-X-MAP:URI="https://video-weaver.example.com/primevideo/chunked/live-init.mp4"',
  "#EXTINF:2.000,live",
  "https://video-weaver.example.com/primevideo/chunked/live-100.m4s",
].join("\n");
const adPlaylist = [
  "#EXTM3U",
  "#EXT-X-VERSION:7",
  "#EXT-X-TARGETDURATION:2",
  "#EXT-X-MEDIA-SEQUENCE:101",
  adCue,
  '#EXT-X-MAP:URI="https://video-weaver.example.com/primevideo/chunked/ad-init.mp4"',
  "#EXTINF:2.000,stitched",
  "https://video-weaver.example.com/primevideo/chunked/ad-101.m4s",
].join("\n");
const recoveredOriginal = [
  "#EXTM3U",
  "#EXT-X-VERSION:7",
  "#EXT-X-TARGETDURATION:2",
  "#EXT-X-MEDIA-SEQUENCE:102",
  '#EXT-X-MAP:URI="https://video-weaver.example.com/primevideo/chunked/live-init.mp4"',
  "#EXTINF:2.000,live",
  "https://video-weaver.example.com/primevideo/chunked/live-102.m4s",
].join("\n");
const cleanBackup = [
  "#EXTM3U",
  "#EXT-X-VERSION:7",
  "#EXT-X-TARGETDURATION:2",
  "#EXT-X-MEDIA-SEQUENCE:900",
  '#EXT-X-MAP:URI="https://video-weaver.example.com/primevideo/embed/chunked/embed-init.mp4"',
  "#EXTINF:2.000,live",
  "https://video-weaver.example.com/primevideo/embed/chunked/embed-900.m4s",
].join("\n");

describe("protected Twitch fMP4 playlists", () => {
  beforeEach(async () => {
    resetTwitchAdBlockServiceForTests();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    initAdBlockService({ enabled: true, backupPlayerTypes: ["embed"] });
    await processMasterPlaylist(masterUrl, masterPlaylist, "primevideo");
  });

  afterEach(async () => {
    await waitForTwitchAdBlockServiceIdleForTests();
    resetTwitchAdBlockServiceForTests();
    vi.unstubAllGlobals();
  });

  it("holds ad media and its map, then restores the clean map with the recovered stream", async () => {
    expect(await processMediaPlaylist(mediaUrl, cleanOriginal)).toBe(cleanOriginal);
    expect(getAdBlockStatus("primevideo").isShowingAd).toBe(false);

    const heldAd = await processMediaPlaylist(mediaUrl, adPlaylist);
    expect(heldAd).toBe(
      [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        "#EXT-X-TARGETDURATION:2",
        "#EXT-X-MEDIA-SEQUENCE:101",
        adCue,
      ].join("\n")
    );
    expect(getAdBlockStatus("primevideo").isShowingAd).toBe(true);

    const recovered = await processMediaPlaylist(mediaUrl, recoveredOriginal);
    expect(recovered).toBe(recoveredOriginal);
    expect(getAdBlockStatus("primevideo").isShowingAd).toBe(false);
  });

  it("keeps cdm=wv on a protected backup request and serves its clean fMP4 map", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url === "https://gql.twitch.tv/gql") {
          return new Response(
            JSON.stringify({
              data: { streamPlaybackAccessToken: { signature: "backup-sig", value: "{}" } },
            }),
            { status: 200 }
          );
        }
        if (url.startsWith("https://usher.ttvnw.net/")) {
          return new Response(backupMasterPlaylist, { status: 200 });
        }
        if (url === backupUrl) return new Response(cleanBackup, { status: 200 });
        return new Response("", { status: 503 });
      })
    );

    const heldAd = await processMediaPlaylist(mediaUrl, adPlaylist);
    expect(heldAd).not.toContain("ad-101.m4s");
    await waitForTwitchAdBlockServiceIdleForTests();

    expect(requestedUrls.filter((url) => url.startsWith("https://usher.ttvnw.net/"))).toEqual([
      "https://usher.ttvnw.net/api/channel/hls/primevideo.m3u8?cdm=wv&sig=backup-sig&token=%7B%7D",
    ]);
    const servedBackup = await processMediaPlaylist(mediaUrl, adPlaylist);
    expect(servedBackup).toBe(cleanBackup);
    expect(getAdBlockStatus("primevideo")).toMatchObject({
      isShowingAd: true,
      isUsingFallbackMode: false,
      activePlayerType: "embed",
    });
  });
});
