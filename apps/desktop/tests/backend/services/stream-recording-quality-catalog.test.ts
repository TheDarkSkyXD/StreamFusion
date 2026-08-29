import { describe, expect, it, vi } from "vitest";

import {
  fetchStreamRecordingQualityCatalog,
  parseStreamRecordingQualityCatalog,
  selectStreamRecordingQuality,
} from "@backend/services/stream-recording-quality-catalog";

// Guards: recording quality choices come from the HLS master playlist without audio-only renditions.
// Guards: reconnect fallback is deterministic and continues to target the user's original quality.
describe("Stream Recording quality catalog", () => {
  it("normalizes video variants and excludes audio-only entries", () => {
    const playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=7800000,AVERAGE-BANDWIDTH=6500000,RESOLUTION=1920x1080,FRAME-RATE=60.000,VIDEO="chunked"
source/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1280x720,FRAME-RATE=59.940,VIDEO="720p60"
720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2",AUDIO="audio_only"
audio/index.m3u8
`;

    expect(
      parseStreamRecordingQualityCatalog(
        playlist,
        "https://video.example/live/master.m3u8?token=secret"
      )
    ).toEqual([
      {
        quality: "Source",
        url: "https://video.example/live/source/index.m3u8",
        width: 1920,
        height: 1080,
        fps: 60,
        bitrate: 6500000,
        isSource: true,
      },
      {
        quality: "720p60",
        url: "https://video.example/live/720/index.m3u8",
        width: 1280,
        height: 720,
        fps: 59.94,
        bitrate: 3200000,
        isSource: false,
      },
    ]);
  });

  it("selects Source as highest and breaks equal height distance toward lower quality", () => {
    const variants = [
      { quality: "1080p60", url: "1080", height: 1080, fps: 60, bitrate: 6_000_000 },
      { quality: "720p60", url: "720", height: 720, fps: 60, bitrate: 3_000_000 },
      { quality: "480p30", url: "480", height: 480, fps: 30, bitrate: 1_000_000 },
    ];

    expect(
      selectStreamRecordingQuality(variants, {
        quality: "Source",
        height: 1080,
        fps: 60,
        bitrate: 6_000_000,
        isSource: true,
      })?.quality
    ).toBe("1080p60");
    expect(
      selectStreamRecordingQuality(
        [
          { quality: "1080p60", url: "encoded", height: 1080, fps: 60, bitrate: 8_000_000 },
          { quality: "Source", url: "source", height: 1080, fps: 60, bitrate: 6_000_000 },
        ],
        { quality: "Source", height: 1080, fps: 60, bitrate: 6_000_000, isSource: true }
      )?.url
    ).toBe("source");
    expect(
      selectStreamRecordingQuality(variants, {
        quality: "900p60",
        height: 900,
        fps: 60,
        bitrate: 4_000_000,
        isSource: false,
      })?.quality
    ).toBe("720p60");
  });

  it("fetches the master playlist through the recording-owned abortable boundary", async () => {
    const controller = new AbortController();
    const fetchPlaylist = vi.fn(
      async () =>
        new Response(
          "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=60\n720.m3u8\n",
          { status: 200 }
        )
    );

    await expect(
      fetchStreamRecordingQualityCatalog({
        masterUrl: "https://cdn.example/master.m3u8",
        signal: controller.signal,
        fetchPlaylist,
      })
    ).resolves.toEqual([
      expect.objectContaining({
        quality: "720p60",
        height: 720,
        url: "https://cdn.example/720.m3u8",
      }),
    ]);
    expect(fetchPlaylist).toHaveBeenCalledWith("https://cdn.example/master.m3u8", {
      signal: controller.signal,
    });
  });
});
