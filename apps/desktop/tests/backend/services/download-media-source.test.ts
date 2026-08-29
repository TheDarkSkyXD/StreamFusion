import { describe, expect, it } from "vitest";

import { assertAllowedRendererMediaUrl } from "@backend/services/download-media-source";

// Guards: renderer-provided media URLs cannot turn privileged download transports into SSRF or local-file readers.
describe("renderer download media source validation", () => {
  it("accepts provider media URLs with the expected secure media form", () => {
    expect(
      assertAllowedRendererMediaUrl({
        platform: "kick",
        kind: "clip",
        url: "https://clips.kick.com/clip-1.mp4?token=signed",
      })
    ).toBe("https://clips.kick.com/clip-1.mp4?token=signed");
    expect(
      assertAllowedRendererMediaUrl({
        platform: "kick",
        kind: "video",
        url: "https://abc.us-west-2.playback.live-video.net/vod/asset/master.m3u8?token=signed",
      })
    ).toContain("master.m3u8");
  });

  it.each([
    "file:///C:/Windows/win.ini",
    "http://clips.kick.com/clip-1.mp4",
    "https://localhost/clip.mp4",
    "https://127.0.0.1/clip.mp4",
    "https://192.168.1.2/clip.mp4",
    "https://clips.kick.com:8443/clip.mp4",
    "https://clips.kick.com/thumbnail.webp",
    "https://evil.example/clip.mp4",
    "https://clips.kick.com.evil.example/clip.mp4",
  ])("rejects untrusted renderer source %s", (url) => {
    expect(() =>
      assertAllowedRendererMediaUrl({ platform: "kick", kind: "clip", url })
    ).toThrow("Untrusted Kick clip media URL");
  });

  it("never accepts a renderer-supplied Twitch playback URL", () => {
    expect(() =>
      assertAllowedRendererMediaUrl({
        platform: "twitch",
        kind: "video",
        url: "https://usher.ttvnw.net/vod/123.m3u8",
      })
    ).toThrow("Twitch media must be freshly resolved");
  });
});
