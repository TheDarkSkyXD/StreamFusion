import { describe, expect, it, vi } from "vitest";

import { createTwitchLivePlaybackSource } from "../adapters/twitch/twitch-live-playback-source";
import { twitchHlsRequestHeaders } from "../domain/hls-request-headers";

const target = {
  channelId: "1",
  channelName: "ninja",
  platform: "twitch" as const,
};

const tokenResponse = new Response(
  JSON.stringify({
    data: {
      streamPlaybackAccessToken: {
        signature: "sig",
        value: '{"authorization":{"forbidden":false}}',
      },
    },
  }),
  { status: 200 },
);

describe("twitch live playback source", () => {
  it("returns offline when a request fails without DOMException in the runtime", async () => {
    vi.stubGlobal("DOMException", undefined);
    try {
      const source = createTwitchLivePlaybackSource({
        fetch: async () => {
          throw new TypeError("Network request failed");
        },
      });

      await expect(
        source.resolve({ signal: new AbortController().signal, target }),
      ).resolves.toMatchObject({
        failure: { kind: "offline" },
        kind: "unavailable",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("still returns cancelled for an aborted request without DOMException", async () => {
    vi.stubGlobal("DOMException", undefined);
    try {
      const source = createTwitchLivePlaybackSource({
        fetch: async () => {
          throw Object.assign(new Error("The operation was aborted"), {
            name: "AbortError",
          });
        },
      });

      await expect(
        source.resolve({ signal: new AbortController().signal, target }),
      ).resolves.toMatchObject({
        failure: { kind: "cancelled" },
        kind: "unavailable",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("builds an HTTPS Usher URL from a guest token", async () => {
    const source = createTwitchLivePlaybackSource({
      fetch: async () => tokenResponse.clone(),
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
    expect(result.requestHeaders).toEqual(twitchHlsRequestHeaders());
  });

  it("resolves named channels through Twitch GQL instead of a local fixture", async () => {
    const fetch = vi.fn(async () => tokenResponse.clone());
    const source = createTwitchLivePlaybackSource({ fetch });
    const result = await source.resolve({
      signal: new AbortController().signal,
      target: {
        channelId: "channel-1",
        channelName: "proofstreamer",
        platform: "twitch",
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.sourceUri).toContain(
      "https://usher.ttvnw.net/api/channel/hls/proofstreamer.m3u8",
    );
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
