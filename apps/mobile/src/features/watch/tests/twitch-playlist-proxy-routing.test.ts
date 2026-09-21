import { describe, expect, it } from "vitest";

import { asHlsSourceUri } from "../domain/hls-source";
import { playlistProxyPlaybackAttempts } from "../domain/twitch-playlist-proxy-routing";
import type { WatchTarget } from "../capabilities/watch";

const directUri = asHlsSourceUri("https://usher.ttvnw.net/api/channel/hls/xqc.m3u8")!;
const headers = { Origin: "https://www.twitch.tv" };
const liveTarget: WatchTarget = {
  channelId: "1",
  channelName: "xqc",
  platform: "twitch",
};

describe("playlistProxyPlaybackAttempts", () => {
  it("returns only the direct URI when playlist proxy is off", () => {
    expect(
      playlistProxyPlaybackAttempts({
        direct: { requestHeaders: headers, sourceUri: directUri },
        preferences: { enabled: false, sources: [] },
        target: liveTarget,
      }),
    ).toEqual([{ requestHeaders: headers, sourceUri: directUri }]);
  });

  it("prepends resolved proxy URLs ahead of direct Twitch for live Watch", () => {
    const attempts = playlistProxyPlaybackAttempts({
      direct: { requestHeaders: headers, sourceUri: directUri },
      preferences: {
        enabled: true,
        sources: [
          {
            addQueryParams: false,
            enabled: true,
            id: "first",
            url: "https://eu.luminous.dev/live/$channel",
          },
          {
            addQueryParams: false,
            enabled: false,
            id: "skipped",
            url: "https://skip.example/live/$channel",
          },
          {
            addQueryParams: true,
            enabled: true,
            id: "second",
            url: "https://eu2.luminous.dev/live/$channel",
          },
        ],
      },
      target: liveTarget,
    });
    expect(attempts.map((attempt) => attempt.sourceUri)).toEqual([
      "https://eu.luminous.dev/live/xqc",
      "https://eu2.luminous.dev/live/xqc?allow_source=true&allow_audio_only=true&fast_bread=true",
      directUri,
    ]);
  });

  it("does not rewrite Kick or recorded Twitch targets", () => {
    const kick = playlistProxyPlaybackAttempts({
      direct: { requestHeaders: headers, sourceUri: directUri },
      preferences: {
        enabled: true,
        sources: [
          {
            addQueryParams: false,
            enabled: true,
            id: "first",
            url: "https://eu.luminous.dev/live/$channel",
          },
        ],
      },
      target: { channelId: "k", channelName: "kicklive", platform: "kick" },
    });
    expect(kick).toHaveLength(1);
    const vod = playlistProxyPlaybackAttempts({
      direct: { requestHeaders: headers, sourceUri: directUri },
      preferences: {
        enabled: true,
        sources: [
          {
            addQueryParams: false,
            enabled: true,
            id: "first",
            url: "https://eu.luminous.dev/live/$channel",
          },
        ],
      },
      target: {
        ...liveTarget,
        media: {
          durationSeconds: 60,
          id: "v1",
          kind: "video",
          title: "vod",
        },
      },
    });
    expect(vod).toHaveLength(1);
  });
});
