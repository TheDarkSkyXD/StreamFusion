import { describe, expect, it } from "vitest";

import { createTwitchLivePlaybackSource } from "../adapters/twitch/twitch-live-playback-source";

const target = {
  channelId: "1",
  channelName: "ninja",
  platform: "twitch" as const,
};

describe("twitch live playback source", () => {
  it("builds an HTTPS Usher URL from a guest token", async () => {
    const source = createTwitchLivePlaybackSource({
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: {
              streamPlaybackAccessToken: {
                signature: "sig",
                value: '{"authorization":{"forbidden":false}}',
              },
            },
          }),
          { status: 200 },
        ),
    });
    const result = await source.resolve({
      signal: new AbortController().signal,
      target,
    });
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.sourceUri).toContain(
      "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8",
    );
    expect(result.sourceUri).toContain("sig=sig");
  });

  it("treats a missing token as channel-offline", async () => {
    const source = createTwitchLivePlaybackSource({
      fetch: async () =>
        new Response(JSON.stringify({ data: { streamPlaybackAccessToken: null } }), {
          status: 200,
        }),
    });
    await expect(
      source.resolve({ signal: new AbortController().signal, target }),
    ).resolves.toMatchObject({
      failure: { kind: "channel-offline" },
      kind: "unavailable",
    });
  });
});
