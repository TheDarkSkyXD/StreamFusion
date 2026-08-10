import { describe, expect, it } from "vitest";

import {
  findTwitchPlaylistAlignment,
  keepTwitchBackupRenditions,
  keepTwitchRenditionResolution,
  rankTwitchRenditionCandidates,
  rankTwitchRenditions,
} from "@/lib/twitch-rendition-continuity";

// Guards: ad blocking may vary frame rate/bitrate within the active resolution but must never hide a lower-resolution playlist under the selected level.
describe("Twitch rendition continuity", () => {
  it("keeps only candidates at the active resolution", () => {
    const target = {
      resolution: "1920x1080",
      frameRate: 60,
      bandwidth: 6_000_000,
      codecs: "avc1.64002A",
    };

    const eligible = keepTwitchRenditionResolution(
      [
        { ...target, frameRate: 30, url: "1080p30" },
        { ...target, resolution: "1280x720", url: "720p60" },
      ],
      target
    );

    expect(eligible.map((candidate) => candidate.url)).toEqual(["1080p30"]);
  });

  it("raises a transient sub-480p startup rendition to 480p before a 360p emergency fallback", () => {
    const target = {
      resolution: "284x160",
      frameRate: 30,
      bandwidth: 230_000,
      codecs: "avc1.4D401F",
    };

    const eligible = keepTwitchBackupRenditions(
      [
        { ...target, url: "160p30" },
        { ...target, resolution: "640x360", bandwidth: 800_000, url: "360p30" },
        { ...target, resolution: "852x480", bandwidth: 1_500_000, url: "480p30" },
        { ...target, resolution: "1280x720", bandwidth: 3_000_000, url: "720p30" },
      ],
      target
    );

    expect(eligible.map((candidate) => candidate.url)).toEqual(["480p30", "360p30"]);
  });

  it("keeps the active quality first, then 480p, then 360p, and never admits 160p", () => {
    const target = {
      resolution: "1920x1080",
      frameRate: 60,
      bandwidth: 6_000_000,
      codecs: "avc1.64002A",
    };

    const eligible = keepTwitchBackupRenditions(
      [
        { ...target, resolution: "284x160", url: "160p30" },
        { ...target, resolution: "640x360", url: "360p30" },
        { ...target, resolution: "852x480", url: "480p30" },
        { ...target, resolution: "1280x720", url: "720p60" },
        { ...target, url: "1080p60" },
      ],
      target
    );

    expect(eligible.map((candidate) => candidate.url)).toEqual([
      "1080p60",
      "480p30",
      "360p30",
    ]);
  });

  it("ranks the exact active rendition first", () => {
    const masterPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=60.000,CODECS="avc1.4D401F"
https://backup.example/720p60.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=6100000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A"
https://backup.example/1080p60.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,FRAME-RATE=30.000,CODECS="avc1.64002A"
https://backup.example/1080p30.m3u8`;

    const ranked = rankTwitchRenditions(masterPlaylist, {
      resolution: "1920x1080",
      frameRate: 60,
      bandwidth: 6_000_000,
      codecs: "avc1.64002A",
    });

    expect(ranked.map((rendition) => rendition.url)).toEqual([
      "https://backup.example/1080p60.m3u8",
      "https://backup.example/1080p30.m3u8",
      "https://backup.example/720p60.m3u8",
    ]);
  });

  it("keeps a same-resolution codec fallback ahead of a lower HEVC rendition", () => {
    const masterPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=60.000,CODECS="hev1.1.6.L93"
https://backup.example/hevc-720p60.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5900000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A"
https://backup.example/avc-1080p60.m3u8`;

    const ranked = rankTwitchRenditions(masterPlaylist, {
      resolution: "1920x1080",
      frameRate: 60,
      bandwidth: 6_000_000,
      codecs: "hev1.1.6.L120",
    });

    expect(ranked[0].url).toBe("https://backup.example/avc-1080p60.m3u8");
  });

  it("ranks renditions globally across player types", () => {
    const target = {
      resolution: "1920x1080",
      frameRate: 60,
      bandwidth: 6_000_000,
      codecs: "avc1.64002A",
    };
    const ranked = rankTwitchRenditionCandidates(
      [
        { ...target, resolution: "1280x720", url: "embed-720", playerType: "embed" },
        { ...target, url: "popout-1080", playerType: "popout" },
        { ...target, resolution: "852x480", url: "popout-480", playerType: "popout" },
      ],
      target
    );

    expect(ranked.map((candidate) => candidate.url)).toEqual([
      "popout-1080",
      "embed-720",
      "popout-480",
    ]);
  });

  it("accepts a backup only when sequence and program date time align", () => {
    const activePlaylist = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:500
#EXT-X-PROGRAM-DATE-TIME:2026-08-02T12:00:00.000Z
#EXTINF:2.000,
https://active.example/ad-500.ts
#EXT-X-PROGRAM-DATE-TIME:2026-08-02T12:00:02.000Z
#EXTINF:2.000,
https://active.example/ad-501.ts`;
    const alignedBackup = activePlaylist
      .replaceAll("active.example", "clean.example")
      .replaceAll("ad-", "live-");
    const mistimedBackup = alignedBackup
      .replace("12:00:00.000Z", "12:00:01.000Z")
      .replace("12:00:02.000Z", "12:00:03.000Z");
    const missingTimesBackup = alignedBackup.replace(/^#EXT-X-PROGRAM-DATE-TIME:.*\n/gm, "");

    expect(findTwitchPlaylistAlignment(activePlaylist, alignedBackup)).toEqual({
      mediaSequence: 500,
      programDateTime: "2026-08-02T12:00:00.000Z",
    });
    expect(findTwitchPlaylistAlignment(activePlaylist, mistimedBackup)).toBeNull();
    expect(findTwitchPlaylistAlignment(activePlaylist, missingTimesBackup)).toBeNull();
  });

  it("uses sequence-only alignment when the active playlist has no program date time", () => {
    const activePlaylist = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:800
#EXTINF:2.000,
https://active.example/ad-800.ts`;
    const candidatePlaylist = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:800
#EXT-X-PROGRAM-DATE-TIME:2026-08-02T12:00:00.000Z
#EXTINF:2.000,
https://clean.example/live-800.ts`;

    expect(findTwitchPlaylistAlignment(activePlaylist, candidatePlaylist)).toEqual({
      mediaSequence: 800,
      programDateTime: "2026-08-02T12:00:00.000Z",
    });
  });

  it("aligns player-type backups by program date time when media sequences differ", () => {
    const activePlaylist = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:500
#EXT-X-PROGRAM-DATE-TIME:2026-08-03T13:32:08.000Z
#EXTINF:2.000,
https://active.example/ad-500.ts
#EXT-X-PROGRAM-DATE-TIME:2026-08-03T13:32:10.000Z
#EXTINF:2.000,
https://active.example/ad-501.ts`;
    const candidatePlaylist = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:900
#EXT-X-PROGRAM-DATE-TIME:2026-08-03T13:32:08.000Z
#EXTINF:2.000,
https://clean.example/live-900.ts
#EXT-X-PROGRAM-DATE-TIME:2026-08-03T13:32:10.000Z
#EXTINF:2.000,
https://clean.example/live-901.ts`;

    expect(findTwitchPlaylistAlignment(activePlaylist, candidatePlaylist)).toEqual({
      mediaSequence: 500,
      programDateTime: "2026-08-03T13:32:08.000Z",
    });
  });

  it("finds the first aligned boundary when restoring the active rendition", () => {
    const backupPlaylist = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:500
#EXT-X-PROGRAM-DATE-TIME:2026-08-02T12:00:00.000Z
#EXTINF:2.000,
https://backup.example/live-500.ts
#EXT-X-PROGRAM-DATE-TIME:2026-08-02T12:00:02.000Z
#EXTINF:2.000,
https://backup.example/live-501.ts`;
    const restoredPlaylist = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:501
#EXT-X-PROGRAM-DATE-TIME:2026-08-02T12:00:02.000Z
#EXTINF:2.000,
https://active.example/live-501.ts
#EXT-X-PROGRAM-DATE-TIME:2026-08-02T12:00:04.000Z
#EXTINF:2.000,
https://active.example/live-502.ts`;

    expect(findTwitchPlaylistAlignment(backupPlaylist, restoredPlaylist)).toEqual({
      mediaSequence: 501,
      programDateTime: "2026-08-02T12:00:02.000Z",
    });
  });
});
