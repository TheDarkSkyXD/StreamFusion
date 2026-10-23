import { describe, expect, it, vi } from "vitest";

import { createTwitchLivePlaybackSource } from "../adapters/twitch/twitch-live-playback-source";
import { twitchHlsRequestHeaders } from "../domain/hls-request-headers";

const target = {
  channelId: "1",
  channelName: "ninja",
  platform: "twitch" as const,
};

function twitchResponse(
  isEncrypted: unknown = false,
  stream: unknown = { isEncrypted },
) {
  return new Response(
    JSON.stringify([
      { data: { user: { stream } } },
      {
        data: {
          streamPlaybackAccessToken: {
            signature: "sig",
            value: '{"authorization":{"forbidden":false}}',
          },
        },
      },
    ]),
    { status: 200 },
  );
}

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
      fetch: async () => twitchResponse(),
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
    expect(result).not.toHaveProperty("protection");
  });

  it("selects a Widevine master and protection descriptor for encrypted Twitch live", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      twitchResponse(true),
    );
    const source = createTwitchLivePlaybackSource({ fetch });
    const result = await source.resolve({
      signal: new AbortController().signal,
      target,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = fetch.mock.calls[0]?.[1]?.body;
    expect(typeof body).toBe("string");
    if (typeof body !== "string") return;
    const request: unknown = JSON.parse(body);
    expect(request).toMatchObject([
      { operationName: "VideoPlayerStreamMetadata" },
      { operationName: "PlaybackAccessToken" },
    ]);
    expect(result).toMatchObject({
      kind: "resolved",
      protection: {
        kind: "widevine",
        authorization: {
          kind: "provider-live",
          platform: "twitch",
          channelName: "ninja",
        },
      },
    });
    if (result.kind !== "resolved") return;
    const params = new URL(result.sourceUri).searchParams;
    expect(params.get("cdm")).toBe("wv");
    expect(params.get("player_backend")).toBe("mediaplayer");
    expect(params.get("supported_codecs")).toBe("h264");
    expect(params.get("playlist_include_framerate")).toBe("true");
    expect(params.get("allow_source")).toBe("true");
    expect(params.get("allow_audio_only")).toBe("true");
  });

  it("reports an offline stream even when Twitch issues a playback token", async () => {
    const source = createTwitchLivePlaybackSource({
      fetch: async () => twitchResponse(false, null),
    });
    await expect(
      source.resolve({ signal: new AbortController().signal, target }),
    ).resolves.toMatchObject({
      kind: "unavailable",
      failure: { kind: "channel-offline" },
    });
  });

  it.each([{}, { isEncrypted: "true" }])(
    "rejects malformed stream metadata %j",
    async (stream) => {
      const source = createTwitchLivePlaybackSource({
        fetch: async () => twitchResponse(true, stream),
      });
      await expect(
        source.resolve({ signal: new AbortController().signal, target }),
      ).resolves.toMatchObject({
        kind: "unavailable",
        failure: { kind: "invalid-response" },
      });
    },
  );

  it("rejects GraphQL metadata errors even when a clear flag is present", async () => {
    const source = createTwitchLivePlaybackSource({
      fetch: async () =>
        new Response(
          JSON.stringify([
            {
              data: { user: { stream: { isEncrypted: false } } },
              errors: [{ message: "failed" }],
            },
            {
              data: {
                streamPlaybackAccessToken: { signature: "sig", value: "token" },
              },
            },
          ]),
          { status: 200 },
        ),
    });
    await expect(
      source.resolve({ signal: new AbortController().signal, target }),
    ).resolves.toMatchObject({
      kind: "unavailable",
      failure: { kind: "invalid-response" },
    });
  });

  it("does not report a metadata failure as channel-offline when the token is absent", async () => {
    const source = createTwitchLivePlaybackSource({
      fetch: async () =>
        new Response(
          JSON.stringify([
            { errors: [{ message: "failed" }] },
            { data: { streamPlaybackAccessToken: null } },
          ]),
          { status: 200 },
        ),
    });
    await expect(
      source.resolve({ signal: new AbortController().signal, target }),
    ).resolves.toMatchObject({
      kind: "unavailable",
      failure: { kind: "invalid-response" },
    });
  });

  it("resolves named channels through Twitch GQL instead of a local fixture", async () => {
    const fetch = vi.fn(async () => twitchResponse());
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
        new Response(
          JSON.stringify([
            { data: { user: { stream: { isEncrypted: false } } } },
            { data: { streamPlaybackAccessToken: null } },
          ]),
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
});
