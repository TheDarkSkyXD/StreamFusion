import { describe, expect, it, vi } from "vitest";

import { resolveDefaultVideoPlayback } from "@backend/services/video-download-default-service";

// Guards: Twitch VOD downloads always resolve a fresh main-process source and never trust renderer playback URLs.
describe("default video download playback resolution", () => {
  it("ignores renderer playback URLs for Twitch and resolves a fresh source", async () => {
    const twitchResolver = {
      getVodPlaybackUrl: vi.fn(async () => ({
        url: "https://usher.ttvnw.net/vod/123.m3u8?fresh=1",
        format: "hls",
      })),
    };
    const kickResolver = { getVodPlaybackUrl: vi.fn() };

    await expect(
      resolveDefaultVideoPlayback(
        {
          platform: "twitch",
          videoId: "123",
          title: "Finals",
          channelName: "speedrunpro",
          playbackUrl: "https://attacker.example/vod.m3u8",
        },
        { twitchResolver, kickResolver }
      )
    ).resolves.toEqual({
      url: "https://usher.ttvnw.net/vod/123.m3u8?fresh=1",
      format: "hls",
      durationSeconds: null,
    });
    expect(twitchResolver.getVodPlaybackUrl).toHaveBeenCalledWith("123");
    expect(kickResolver.getVodPlaybackUrl).not.toHaveBeenCalled();
  });

  it("uses a validated Kick renderer source only when fresh resolution fails", async () => {
    const twitchResolver = { getVodPlaybackUrl: vi.fn() };
    const kickResolver = {
      getVodPlaybackUrl: vi.fn(async () => {
        throw new Error("Kick VOD lookup failed");
      }),
    };
    const playbackUrl =
      "https://abc.us-west-2.playback.live-video.net/vod/asset/master.m3u8?token=signed";

    await expect(
      resolveDefaultVideoPlayback(
        {
          platform: "kick",
          videoId: "numeric-id",
          title: "Finals",
          channelName: "speedrunpro",
          playbackUrl,
        },
        { twitchResolver, kickResolver }
      )
    ).resolves.toMatchObject({ url: playbackUrl, format: "hls" });
    expect(kickResolver.getVodPlaybackUrl).toHaveBeenCalledWith("numeric-id");
  });

  it("rejects an untrusted Kick fallback after fresh resolution fails", async () => {
    const kickResolver = {
      getVodPlaybackUrl: vi.fn(async () => {
        throw new Error("Kick VOD lookup failed");
      }),
    };

    await expect(
      resolveDefaultVideoPlayback(
        {
          platform: "kick",
          videoId: "numeric-id",
          title: "Finals",
          channelName: "speedrunpro",
          playbackUrl: "http://127.0.0.1/private.m3u8",
        },
        { twitchResolver: { getVodPlaybackUrl: vi.fn() }, kickResolver }
      )
    ).rejects.toThrow("Untrusted Kick video media URL");
  });

  it("does not pass a renderer URL disguised as a Kick video id to the resolver", async () => {
    const kickResolver = { getVodPlaybackUrl: vi.fn() };

    await expect(
      resolveDefaultVideoPlayback(
        {
          platform: "kick",
          videoId: "http://127.0.0.1/private.m3u8",
          title: "Finals",
          channelName: "speedrunpro",
        },
        { twitchResolver: { getVodPlaybackUrl: vi.fn() }, kickResolver }
      )
    ).rejects.toThrow("Invalid Kick video id");
    expect(kickResolver.getVodPlaybackUrl).not.toHaveBeenCalled();
  });
});
