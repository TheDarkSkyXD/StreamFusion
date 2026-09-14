import { describe, expect, it } from "vitest";

import { createKickLivePlaybackSource } from "../adapters/kick/kick-live-playback-source";

const target = {
  channelId: "1",
  channelName: "xqc",
  platform: "kick" as const,
};

describe("kick live playback source", () => {
  it("requires livestream.is_live before accepting playback_url", async () => {
    const source = createKickLivePlaybackSource({
      fetch: async () =>
        new Response(
          JSON.stringify({
            livestream: { is_live: false },
            playback_url: "https://kick.com/live.m3u8",
          }),
          { status: 200 },
        ),
    });
    await expect(
      source.resolve({ signal: new AbortController().signal, target }),
    ).resolves.toMatchObject({
      failure: { kind: "channel-offline" },
      kind: "unavailable",
    });
  });

  it("resolves HTTPS HLS from a live payload", async () => {
    const source = createKickLivePlaybackSource({
      fetch: async () =>
        new Response(
          JSON.stringify({
            livestream: { is_live: true },
            playback_url: "https://playback.kick.com/live.m3u8",
          }),
          { status: 200 },
        ),
    });
    await expect(
      source.resolve({ signal: new AbortController().signal, target }),
    ).resolves.toMatchObject({
      kind: "resolved",
      requestHeaders: {
        Origin: "https://kick.com",
        Referer: "https://kick.com/",
      },
      sourceUri: "https://playback.kick.com/live.m3u8",
    });
  });
});
