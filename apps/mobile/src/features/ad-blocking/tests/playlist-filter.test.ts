import { describe, expect, it } from "vitest";

import { filterTwitchPlaylist } from "../domain/playlist-filter";

const CLEAN = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:10
#EXTINF:2.000,
https://video.twitch.tv/segment10.ts
#EXTINF:2.000,
https://video.twitch.tv/segment11.ts
`;

const STITCHED = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",DURATION=4.0
#EXTINF:2.000,
https://d2nvs31859zcd8.cloudfront.net/ad/seg0.ts
#EXTINF:2.000,
https://d2nvs31859zcd8.cloudfront.net/ad/seg1.ts
#EXTINF:2.000,
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

describe("Twitch playlist filter", () => {
  it("keeps a clean playlist", () => {
    const result = filterTwitchPlaylist(CLEAN, "strip");
    expect(result.adsDetected).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.playlist).toContain("segment10.ts");
  });

  it("strips known ad hosts and date ranges", () => {
    const result = filterTwitchPlaylist(STITCHED, "strip");
    expect(result.adsDetected).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.playlist).not.toContain("cloudfront.net");
    expect(result.playlist).not.toContain("EXT-X-DATERANGE");
    expect(result.playlist).toContain("segment10.ts");
  });

  it("strips commercial-break interstitial segments after CUE-OUT", () => {
    const result = filterTwitchPlaylist(COMMERCIAL_BREAK, "strip");
    expect(result.adsDetected).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.playlist).not.toContain("commercial-break-interstitial");
    expect(result.playlist).not.toContain("EXT-X-CUE-OUT");
    expect(result.playlist).toContain("segment10.ts");
    expect(result.playlist).toContain("segment11.ts");
  });

  it("strips EXTINF stitched signifiers even on neutral hosts", () => {
    const result = filterTwitchPlaylist(SIGNIFIER, "strip");
    expect(result.applied).toBe(true);
    expect(result.playlist).not.toContain("signifier-700");
    expect(result.playlist).toContain("segment10.ts");
  });

  it("strips date-range path /ad/ segments until discontinuity", () => {
    const result = filterTwitchPlaylist(DATERANGE_PATH_AD, "strip");
    expect(result.applied).toBe(true);
    expect(result.playlist).not.toContain("segment-200");
    expect(result.playlist).toContain("segment10.ts");
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
});
