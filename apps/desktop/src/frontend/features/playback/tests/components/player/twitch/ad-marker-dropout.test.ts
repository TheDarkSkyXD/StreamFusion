import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAdBlockStatus,
  initAdBlockService,
  processMasterPlaylist,
  processMediaPlaylist,
  resetTwitchAdBlockServiceForTests,
  waitForTwitchAdBlockServiceIdleForTests,
} from "@/features/playback/adapters/browser/twitch/twitch-adblock-service";

const mediaUrl = "https://video-edge.example.com/channel/source/index-dvr.m3u8";
const masterPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.4D401F,mp4a.40.2"
${mediaUrl}`;

const markedAdPlaylist = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:100
#EXT-X-DATERANGE:ID="break-1",CLASS="twitch-stitched-ad",START-DATE="2026-10-19T12:00:00Z",DURATION=30
#EXTINF:2.000,live
https://video-edge.example.com/channel/segment-100.ts
#EXTINF:2.000,live
https://video-edge.example.com/channel/segment-101.ts`;

const markerFreeOverlap = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:101
#EXTINF:2.000,live
https://video-edge.example.com/channel/segment-101.ts
#EXTINF:2.000,live
https://video-edge.example.com/channel/segment-102.ts`;

const newLiveWindow = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:102
#EXTINF:2.000,live
https://video-edge.example.com/channel/segment-102.ts
#EXTINF:2.000,live
https://video-edge.example.com/channel/segment-103.ts`;

const adCue = `#EXT-X-DATERANGE:ID="break-1",CLASS="twitch-stitched-ad",START-DATE="2026-10-19T12:00:00Z",DURATION=30`;

function playlist(...lines: string[]): string {
  return ["#EXTM3U", "#EXT-X-MEDIA-SEQUENCE:100", ...lines].join("\n");
}

function mockBackup(backupPlaylist: () => string | Promise<string>): void {
  const backupUrl = "https://backup.example.com/channel/index-dvr.m3u8";
  const backupMaster = playlist(
    '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.4D401F,mp4a.40.2"',
    backupUrl
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://gql.twitch.tv/gql") {
        return new Response(
          JSON.stringify({
            data: { streamPlaybackAccessToken: { signature: "sig", value: "{}" } },
          }),
          { status: 200 }
        );
      }
      if (url.includes("usher.ttvnw.net")) return new Response(backupMaster, { status: 200 });
      if (url === backupUrl) return new Response(await backupPlaylist(), { status: 200 });
      return new Response("", { status: 503 });
    })
  );
  initAdBlockService({ enabled: true, backupPlayerTypes: ["embed"] });
}

describe("Twitch ad marker dropout", () => {
  beforeEach(async () => {
    resetTwitchAdBlockServiceForTests();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 503 }));
    initAdBlockService({ enabled: true });
    await processMasterPlaylist(
      "https://usher.ttvnw.net/api/channel/hls/dropout.m3u8",
      masterPlaylist,
      "dropout"
    );
  });

  afterEach(async () => {
    await waitForTwitchAdBlockServiceIdleForTests();
    resetTwitchAdBlockServiceForTests();
    vi.unstubAllGlobals();
  });

  it("holds a marker-free playlist while it still contains media from a blocked ad window", async () => {
    const blockedAd = await processMediaPlaylist(mediaUrl, markedAdPlaylist);
    expect(blockedAd).not.toContain("#EXTINF");
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(true);

    await waitForTwitchAdBlockServiceIdleForTests();
    const overlapping = await processMediaPlaylist(mediaUrl, markerFreeOverlap);
    expect(overlapping).not.toContain("#EXTINF");
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(true);

    const live = await processMediaPlaylist(mediaUrl, newLiveWindow);
    expect(live).toContain("https://video-edge.example.com/channel/segment-103.ts");
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(false);
  });

  it.each([
    [
      "an EXTINF URI after intervening tags",
      ["#EXTINF:2,live", "#EXT-X-BYTERANGE:1024@0", "../segment-101.ts"],
      ["#EXTINF:2,live", "https://video-edge.example.com/channel/segment-101.ts"],
    ],
    [
      "a Twitch prefetch URI promoted to a segment",
      ["#EXT-X-TWITCH-PREFETCH:segment-101.ts"],
      ["#EXTINF:2,live", "segment-101.ts"],
    ],
    [
      "a partial segment URI",
      ['#EXT-X-PART:DURATION=0.333,URI="../segment-101.part"'],
      ['#EXT-X-PART:DURATION=0.333,URI="https://video-edge.example.com/channel/segment-101.part"'],
    ],
    [
      "a preload hint promoted to a partial segment",
      ['#EXT-X-PRELOAD-HINT:TYPE=PART,URI="segment-101.part"'],
      ['#EXT-X-PART:DURATION=0.333,URI="segment-101.part"'],
    ],
  ])("holds %s after an ad marker drops out", async (_label, blockedLines, laterLines) => {
    await processMediaPlaylist(mediaUrl, playlist(adCue, ...blockedLines));
    await waitForTwitchAdBlockServiceIdleForTests();

    const result = await processMediaPlaylist(mediaUrl, playlist(...laterLines));

    expect(result).not.toContain("segment-101");
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(true);
  });

  it("releases a clean window that only shares an initialization map and encryption key", async () => {
    const sharedResources = [
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
    ];
    await processMediaPlaylist(
      mediaUrl,
      playlist(adCue, ...sharedResources, "#EXTINF:2,live", "ad.ts")
    );
    await waitForTwitchAdBlockServiceIdleForTests();

    const result = await processMediaPlaylist(
      mediaUrl,
      playlist(...sharedResources, "#EXTINF:2,live", "live.ts")
    );

    expect(result).toContain("live.ts");
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(false);
  });

  it("does not treat a GAP segment URI as playable blocked media", async () => {
    await processMediaPlaylist(mediaUrl, playlist(adCue, "#EXTINF:2,live", "#EXT-X-GAP", "gap.ts"));
    await waitForTwitchAdBlockServiceIdleForTests();

    const result = await processMediaPlaylist(mediaUrl, playlist("#EXTINF:2,live", "gap.ts"));

    expect(result).toContain("gap.ts");
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(false);
  });

  it("keeps all marked media quarantined through consecutive ad windows", async () => {
    await processMediaPlaylist(mediaUrl, playlist(adCue, "#EXTINF:2,live", "first-ad.ts"));
    await processMediaPlaylist(mediaUrl, playlist(adCue, "#EXTINF:2,live", "second-ad.ts"));
    await waitForTwitchAdBlockServiceIdleForTests();

    const result = await processMediaPlaylist(mediaUrl, playlist("#EXTINF:2,live", "first-ad.ts"));

    expect(result).not.toContain("first-ad.ts");
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(true);
  });

  it("holds stale ad media that reappears after the visible ad has ended", async () => {
    await processMediaPlaylist(mediaUrl, playlist(adCue, "#EXTINF:2,live", "first-ad.ts"));
    await processMediaPlaylist(mediaUrl, playlist("#EXTINF:2,live", "recovered.ts"));
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(false);

    const result = await processMediaPlaylist(mediaUrl, playlist("#EXTINF:2,live", "first-ad.ts"));

    expect(result).not.toContain("first-ad.ts");
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(true);
  });

  it("holds stale ad media in the prior rendition after a quality change", async () => {
    const lowerMediaUrl = "https://video-edge.example.com/channel/720p/index-dvr.m3u8";
    await processMasterPlaylist(
      "https://usher.ttvnw.net/api/channel/hls/dropout.m3u8",
      `${masterPlaylist}\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2"\n${lowerMediaUrl}`,
      "dropout"
    );
    await processMediaPlaylist(mediaUrl, playlist(adCue, "#EXTINF:2,live", "first-ad.ts"));
    await processMediaPlaylist(lowerMediaUrl, playlist("#EXTINF:2,live", "recovered.ts"));
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(false);

    const result = await processMediaPlaylist(mediaUrl, playlist("#EXTINF:2,live", "first-ad.ts"));

    expect(result).not.toContain("first-ad.ts");
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(true);
  });

  it("holds a blocked URI reused by another rendition", async () => {
    const lowerMediaUrl = "https://video-edge.example.com/channel/720p/index-dvr.m3u8";
    const blockedUri = "https://video-edge.example.com/channel/first-ad.ts";
    await processMasterPlaylist(
      "https://usher.ttvnw.net/api/channel/hls/dropout.m3u8",
      `${masterPlaylist}\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2"\n${lowerMediaUrl}`,
      "dropout"
    );
    await processMediaPlaylist(mediaUrl, playlist(adCue, "#EXTINF:2,live", blockedUri));
    await processMediaPlaylist(lowerMediaUrl, playlist("#EXTINF:2,live", "recovered.ts"));
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(false);

    const result = await processMediaPlaylist(
      lowerMediaUrl,
      playlist("#EXTINF:2,live", blockedUri)
    );

    expect(result).not.toContain(blockedUri);
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(true);
  });

  it("restarts retirement when another rendition replays blocked media", async () => {
    const lowerMediaUrl = "https://video-edge.example.com/channel/720p/index-dvr.m3u8";
    const blockedUri = "https://video-edge.example.com/channel/first-ad.ts";
    await processMasterPlaylist(
      "https://usher.ttvnw.net/api/channel/hls/dropout.m3u8",
      `${masterPlaylist}\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2"\n${lowerMediaUrl}`,
      "dropout"
    );
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      await processMediaPlaylist(mediaUrl, playlist(adCue, "#EXTINF:2,live", blockedUri));
      await processMediaPlaylist(mediaUrl, playlist("#EXTINF:2,live", "recovered.ts"));
      await processMediaPlaylist(lowerMediaUrl, playlist("#EXTINF:2,live", blockedUri));

      now += 20_000;
      await processMediaPlaylist(mediaUrl, playlist("#EXTINF:2,live", "recovered.ts"));
      const result = await processMediaPlaylist(
        lowerMediaUrl,
        playlist("#EXTINF:2,live", blockedUri)
      );

      expect(result).not.toContain(blockedUri);
      expect(getAdBlockStatus("dropout").isShowingAd).toBe(true);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("retires blocked media only after two clean polls spanning twenty seconds", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      await processMediaPlaylist(mediaUrl, playlist(adCue, "#EXTINF:2,live", "first-ad.ts"));
      await processMediaPlaylist(mediaUrl, playlist("#EXTINF:2,live", "recovered.ts"));
      expect(getAdBlockStatus("dropout").isShowingAd).toBe(false);

      now += 19_000;
      await processMediaPlaylist(mediaUrl, playlist("#EXTINF:2,live", "recovered.ts"));
      const stillBlocked = await processMediaPlaylist(
        mediaUrl,
        playlist("#EXTINF:2,live", "first-ad.ts")
      );
      expect(stillBlocked).not.toContain("first-ad.ts");

      await processMediaPlaylist(mediaUrl, playlist("#EXTINF:2,live", "recovered.ts"));
      now += 20_000;
      await processMediaPlaylist(mediaUrl, playlist("#EXTINF:2,live", "recovered.ts"));
      const retired = await processMediaPlaylist(
        mediaUrl,
        playlist("#EXTINF:2,live", "first-ad.ts")
      );

      expect(retired).toContain("first-ad.ts");
      expect(getAdBlockStatus("dropout").isShowingAd).toBe(false);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("rejects a clean-labeled backup candidate that reuses blocked original media", async () => {
    mockBackup(() =>
      playlist("#EXTINF:2,live", "https://video-edge.example.com/channel/segment-101.ts")
    );
    await processMediaPlaylist(mediaUrl, markedAdPlaylist);
    await waitForTwitchAdBlockServiceIdleForTests();

    const result = await processMediaPlaylist(mediaUrl, markedAdPlaylist);

    expect(result).not.toContain("segment-101.ts");
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(true);
  });

  it("does not publish an ad-era backup fetch after that ad has ended", async () => {
    let finishBackup: (playlist: string) => void = () => {
      throw new Error("backup fetch did not start");
    };
    let backupFetchStarted = false;
    const delayedBackup = new Promise<string>((resolve) => {
      finishBackup = resolve;
    });
    mockBackup(() => {
      backupFetchStarted = true;
      return delayedBackup;
    });

    await processMediaPlaylist(mediaUrl, markedAdPlaylist);
    await vi.waitFor(() => expect(backupFetchStarted).toBe(true));
    await processMediaPlaylist(mediaUrl, newLiveWindow);
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(false);

    finishBackup(
      playlist("#EXTINF:2,live", "https://video-edge.example.com/channel/segment-101.ts")
    );
    await waitForTwitchAdBlockServiceIdleForTests();
    const result = await processMediaPlaylist(
      mediaUrl,
      playlist(adCue, "#EXTINF:2,live", "new-ad.ts")
    );

    expect(result).not.toContain("segment-101.ts");
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(true);
  });

  it("stops serving a backup when a later ad playlist marks its media unsafe", async () => {
    mockBackup(() =>
      playlist("#EXTINF:2,live", "https://backup.example.com/channel/segment-201.ts")
    );
    await processMediaPlaylist(mediaUrl, markedAdPlaylist);
    await waitForTwitchAdBlockServiceIdleForTests();
    expect(await processMediaPlaylist(mediaUrl, markedAdPlaylist)).toContain("segment-201.ts");

    const result = await processMediaPlaylist(
      mediaUrl,
      playlist(adCue, "#EXTINF:2,live", "https://backup.example.com/channel/segment-201.ts")
    );

    expect(result).not.toContain("segment-201.ts");
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(true);
  });

  it("restarts clean-original confirmation after a marker-free blocked poll", async () => {
    mockBackup(() =>
      playlist("#EXTINF:2,live", "https://backup.example.com/channel/segment-201.ts")
    );
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      await processMediaPlaylist(mediaUrl, markedAdPlaylist);
      await waitForTwitchAdBlockServiceIdleForTests();
      expect(await processMediaPlaylist(mediaUrl, markedAdPlaylist)).toContain("segment-201.ts");

      expect(await processMediaPlaylist(mediaUrl, newLiveWindow)).toContain("segment-201.ts");
      expect(await processMediaPlaylist(mediaUrl, markerFreeOverlap)).toContain("segment-201.ts");
      now += 20_000;

      const result = await processMediaPlaylist(mediaUrl, newLiveWindow);

      expect(result).toContain("segment-201.ts");
      expect(getAdBlockStatus("dropout").isShowingAd).toBe(true);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("rejects a refreshed backup that reuses blocked original media", async () => {
    let backupMedia = playlist(
      "#EXTINF:2,live",
      "https://video-edge.example.com/channel/segment-201.ts"
    );
    mockBackup(() => backupMedia);
    await processMediaPlaylist(mediaUrl, markedAdPlaylist);
    await waitForTwitchAdBlockServiceIdleForTests();
    expect(await processMediaPlaylist(mediaUrl, markedAdPlaylist)).toContain("segment-201.ts");

    backupMedia = playlist(
      "#EXTINF:2,live",
      "https://video-edge.example.com/channel/segment-101.ts"
    );
    await waitForTwitchAdBlockServiceIdleForTests();
    await processMediaPlaylist(mediaUrl, markedAdPlaylist);
    await waitForTwitchAdBlockServiceIdleForTests();
    const result = await processMediaPlaylist(mediaUrl, markedAdPlaylist);

    expect(result).not.toContain("segment-101.ts");
    expect(getAdBlockStatus("dropout").isShowingAd).toBe(true);
  });

  it("does not publish an ad-era refresh after the original stream recovers", async () => {
    let finishRefresh: (playlist: string) => void = () => {
      throw new Error("refresh did not start");
    };
    const delayedRefresh = new Promise<string>((resolve) => {
      finishRefresh = resolve;
    });
    let backupFetches = 0;
    mockBackup(() => {
      backupFetches += 1;
      return backupFetches === 1
        ? playlist("#EXTINF:2,live", "https://video-edge.example.com/channel/segment-201.ts")
        : delayedRefresh;
    });
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      await processMediaPlaylist(mediaUrl, markedAdPlaylist);
      await waitForTwitchAdBlockServiceIdleForTests();
      expect(await processMediaPlaylist(mediaUrl, markedAdPlaylist)).toContain("segment-201.ts");
      await vi.waitFor(() => expect(backupFetches).toBe(2));

      await processMediaPlaylist(mediaUrl, newLiveWindow);
      now += 20_000;
      await processMediaPlaylist(mediaUrl, newLiveWindow);
      expect(getAdBlockStatus("dropout").isShowingAd).toBe(false);

      finishRefresh(
        playlist("#EXTINF:2,live", "https://video-edge.example.com/channel/segment-101.ts")
      );
      await waitForTwitchAdBlockServiceIdleForTests();
      const result = await processMediaPlaylist(
        mediaUrl,
        playlist(adCue, "#EXTINF:2,live", "new-ad.ts")
      );

      expect(result).not.toContain("segment-101.ts");
      expect(getAdBlockStatus("dropout").isShowingAd).toBe(true);
    } finally {
      dateNow.mockRestore();
    }
  });
});
