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

  it("keeps the original playlist in canary", () => {
    const result = filterTwitchPlaylist(STITCHED, "canary");
    expect(result.adsDetected).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.playlist).toContain("stitched-ad");
  });

  it("keeps the original playlist when strip would empty it", () => {
    const adsOnly = `#EXTM3U
#EXTINF:2.000,
https://d2nvs31859zcd8.cloudfront.net/ad/only.ts
`;
    const result = filterTwitchPlaylist(adsOnly, "strip");
    expect(result.applied).toBe(false);
    expect(result.playlist).toContain("only.ts");
  });
});
