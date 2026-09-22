import { describe, expect, it } from "vitest";

import {
  filterTwitchPlaylist,
  holdUnsafeMediaPlaylist,
} from "../domain/playlist-filter";

const CLEAN = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:10
#EXTINF:2.000,live
https://video.twitch.tv/segment10.ts
#EXTINF:2.000,live
https://video.twitch.tv/segment11.ts
`;

const STITCHED = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",DURATION=4.0
#EXTINF:2.000,
https://d2nvs31859zcd8.cloudfront.net/ad/seg0.ts
#EXTINF:2.000,
https://d2nvs31859zcd8.cloudfront.net/ad/seg1.ts
#EXTINF:2.000,live
https://video.twitch.tv/segment10.ts
`;

const COMMERCIAL_BREAK = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:440
#EXT-X-CUE-OUT:DURATION=30
#EXT-X-DISCONTINUITY
#EXTINF:2.000,
https://neutral.synthetic.invalid/v1/segment/commercial-break-interstitial-440.ts
#EXTINF:2.000,live
https://video.twitch.tv/segment10.ts
#EXT-X-CUE-IN
#EXTINF:2.000,live
https://video.twitch.tv/segment11.ts
`;

const SIGNIFIER = `#EXTM3U
#EXT-X-VERSION:3
#EXTINF:2.000,stitched
https://neutral.synthetic.invalid/v1/segment/signifier-700.ts
#EXTINF:2.000,live
https://video.twitch.tv/segment10.ts
`;

const DATERANGE_PATH_AD = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-DATERANGE:ID="synthetic-ad",CLASS="twitch-stitched-ad",DURATION=30.000
#EXTINF:2.000,stitched
https://ad-cdn.synthetic.invalid/ad/segment-200.ts?token=redacted
#EXT-X-DISCONTINUITY
#EXTINF:2.000,live
https://video.twitch.tv/segment10.ts
`;

const TWITCH_AD_ATTR = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-DATERANGE:ID="ad-1",X-TV-TWITCH-AD-URL="https://ads.example/track",DURATION=4.0
#EXTINF:2.000,
https://neutral.synthetic.invalid/v1/segment/twitch-ad-attr-1.ts
#EXTINF:2.000,live
https://video.twitch.tv/segment10.ts
`;

const SCTE35_ONLY = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-OATCLS-SCTE35:/DAvAAAAAAAA///wBQb+AAAAAA==
#EXTINF:2.000,
https://neutral.synthetic.invalid/v1/segment/scte-500.ts
`;

describe("Twitch playlist filter", () => {
  it("keeps a clean playlist", () => {
    const result = filterTwitchPlaylist(CLEAN, "strip");
    expect(result.adsDetected).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.playlist).toContain("segment10.ts");
  });

  it("holds known ad hosts and date ranges without serving leftover live", () => {
    const result = filterTwitchPlaylist(STITCHED, "strip");
    expect(result.adsDetected).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.diagnostic).toContain("unsafe-hold");
    expect(result.playlist).not.toContain("cloudfront.net");
    expect(result.playlist).not.toContain("#EXTINF");
    expect(result.playlist).not.toContain("segment10.ts");
  });

  it("holds commercial-break playlists instead of serving interstitial or live residue", () => {
    const result = filterTwitchPlaylist(COMMERCIAL_BREAK, "strip");
    expect(result.adsDetected).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.diagnostic).toContain("unsafe-hold");
    expect(result.playlist).not.toContain("commercial-break-interstitial");
    expect(result.playlist).not.toContain("#EXTINF");
    expect(result.playlist).not.toContain("segment10.ts");
  });

  it("holds EXTINF stitched signifiers even when live residue remains", () => {
    const result = filterTwitchPlaylist(SIGNIFIER, "strip");
    expect(result.applied).toBe(true);
    expect(result.diagnostic).toContain("unsafe-hold");
    expect(result.playlist).not.toContain("signifier-700");
    expect(result.playlist).not.toContain("segment10.ts");
    expect(result.playlist).not.toContain("#EXTINF");
  });

  it("holds date-range path /ad/ playlists without serving post-discontinuity live", () => {
    const result = filterTwitchPlaylist(DATERANGE_PATH_AD, "strip");
    expect(result.applied).toBe(true);
    expect(result.diagnostic).toContain("unsafe-hold");
    expect(result.playlist).not.toContain("segment-200");
    expect(result.playlist).not.toContain("segment10.ts");
    expect(result.playlist).not.toContain("#EXTINF");
  });

  it("detects X-TV-TWITCH-AD daterange attrs and holds without live residue", () => {
    const result = filterTwitchPlaylist(TWITCH_AD_ATTR, "strip");
    expect(result.adsDetected).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.diagnostic).toContain("unsafe-hold");
    expect(result.playlist).not.toContain("twitch-ad-attr-1");
    expect(result.playlist).not.toContain("segment10.ts");
    expect(result.playlist).not.toContain("ads.example/track");
    expect(result.playlist).not.toContain("#EXTINF");
  });

  it("keeps the original playlist in canary", () => {
    const result = filterTwitchPlaylist(STITCHED, "canary");
    expect(result.adsDetected).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.playlist).toContain("stitched-ad");
  });

  it("holds without media when strip would empty an ads-only playlist", () => {
    const adsOnly = `#EXTM3U
#EXT-X-VERSION:3
#EXTINF:2.000,
https://d2nvs31859zcd8.cloudfront.net/ad/only.ts
`;
    const result = filterTwitchPlaylist(adsOnly, "strip");
    expect(result.adsDetected).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.diagnostic).toContain("unsafe-hold");
    expect(result.playlist).not.toContain("only.ts");
    expect(result.playlist).toContain("#EXTM3U");
    expect(result.playlist).toContain("#EXT-X-VERSION:3");
  });

  it("holds interstitial-only commercial breaks instead of keeping the slate", () => {
    const interstitialOnly = `#EXTM3U
#EXT-X-CUE-OUT:DURATION=30
#EXT-X-DISCONTINUITY
#EXTINF:2.000,
https://neutral.synthetic.invalid/v1/segment/commercial-break-interstitial-440.ts
`;
    const result = filterTwitchPlaylist(interstitialOnly, "strip");
    expect(result.adsDetected).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.diagnostic).toContain("unsafe-hold");
    expect(result.playlist).not.toContain("commercial-break-interstitial");
    expect(result.playlist).not.toContain("#EXTINF");
    expect(result.playlist).toContain("#EXTM3U");
    expect(result.playlist).toContain("#EXT-X-DISCONTINUITY");
  });

  it("holds SCTE35-only interstitials instead of serving the slate", () => {
    const result = filterTwitchPlaylist(SCTE35_ONLY, "strip");
    expect(result.adsDetected).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.diagnostic).toContain("unsafe-hold");
    expect(result.playlist).not.toContain("scte-500");
    expect(result.playlist).not.toContain("#EXTINF");
    expect(result.playlist).toContain("#EXTM3U");
  });

  it("holds when strip leaves only non-live residue (no ,live)", () => {
    const nonLiveResidue = `#EXTM3U
#EXT-X-CUE-OUT:DURATION=30
#EXTINF:2.000,
https://neutral.synthetic.invalid/v1/segment/slate.ts
#EXTINF:2.000,
https://video.twitch.tv/ambiguous.ts
`;
    const result = filterTwitchPlaylist(nonLiveResidue, "strip");
    expect(result.applied).toBe(true);
    expect(result.diagnostic).toContain("unsafe-hold");
    expect(result.playlist).not.toContain("slate.ts");
    expect(result.playlist).not.toContain("ambiguous.ts");
    expect(result.playlist).not.toContain("#EXTINF");
  });

  it("holdUnsafeMediaPlaylist drops all media-bearing tags", () => {
    const held = holdUnsafeMediaPlaylist(COMMERCIAL_BREAK);
    expect(held).toContain("#EXTM3U");
    expect(held).not.toContain("#EXTINF");
    expect(held).not.toContain(".ts");
    expect(held).not.toContain("#EXT-X-TWITCH-PREFETCH");
  });
});

const FIXTURE_DIR = new URL("./fixtures/", import.meta.url);

async function readFixture(name: string): Promise<string> {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  return readFileSync(fileURLToPath(new URL(name, FIXTURE_DIR)), "utf8");
}

describe("Twitch playlist filter — commercial-slate m3u8 fixtures", () => {
  it("holds interstitial-only midroll fixture (no media URIs)", async () => {
    const body = await readFixture("interstitial-only-midroll.m3u8");
    const result = filterTwitchPlaylist(body, "strip");
    expect(result.adsDetected).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.diagnostic).toContain("unsafe-hold");
    expect(result.playlist).not.toMatch(/^[^#\s].*\.ts/m);
    expect(result.playlist).not.toContain("#EXTINF");
    expect(result.playlist).not.toContain("commercial-slate");
  });

  it("holds SCTE35-only midroll fixture", async () => {
    const body = await readFixture("scte35-only-midroll.m3u8");
    const result = filterTwitchPlaylist(body, "strip");
    expect(result.diagnostic).toContain("unsafe-hold");
    expect(result.playlist).not.toContain("#EXTINF");
    expect(result.playlist).not.toContain("scte-slate");
  });

  it("holds X-TV-TWITCH-AD-only commercial fixture", async () => {
    const body = await readFixture("xtv-twitch-ad-only.m3u8");
    const result = filterTwitchPlaylist(body, "strip");
    expect(result.adsDetected).toBe(true);
    expect(result.diagnostic).toContain("unsafe-hold");
    expect(result.playlist).not.toContain("#EXTINF");
    expect(result.playlist).not.toContain("xtv-ad-");
  });

  it("holds stitched-commercial-only midroll fixture", async () => {
    const body = await readFixture("stitched-commercial-only.m3u8");
    const result = filterTwitchPlaylist(body, "strip");
    expect(result.diagnostic).toContain("unsafe-hold");
    expect(result.playlist).not.toContain("cloudfront.net");
    expect(result.playlist).not.toContain("#EXTINF");
  });

  it("holds stitched-then-live fixture without serving leftover live rows", async () => {
    const body = await readFixture("stitched-then-live.m3u8");
    const result = filterTwitchPlaylist(body, "strip");
    expect(result.applied).toBe(true);
    expect(result.diagnostic).toContain("unsafe-hold");
    expect(result.playlist).not.toContain("cloudfront.net");
    expect(result.playlist).not.toContain("segment10.ts");
    expect(result.playlist).not.toContain("segment11.ts");
    expect(result.playlist).not.toContain("#EXTINF");
  });

  it("holds live-tagged commercial slate after ad discontinuity (Kamet0 gap)", async () => {
    const body = await readFixture("live-tagged-slate-after-ad.m3u8");
    const result = filterTwitchPlaylist(body, "strip");
    expect(result.adsDetected).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.diagnostic).toContain("unsafe-hold");
    expect(result.playlist).not.toContain("commercial-break-slate");
    expect(result.playlist).not.toContain("cloudfront.net");
    expect(result.playlist).not.toContain("#EXTINF");
  });
});
