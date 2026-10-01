import { describe, expect, it } from "vitest";

import type { LiveStreamCatalogEntry } from "@mobile/features/discovery/capabilities/live-stream-catalog";

import { createKickLivePlaybackSource } from "../adapters/kick/kick-live-playback-source";

const target = {
  channelId: "1",
  channelName: "xqc",
  platform: "kick" as const,
};

describe("kick live playback source", () => {
  it("prefers the fresh signed guest source over a catalog's bare URL", async () => {
    const requests: string[] = [];
    const source = createKickLivePlaybackSource({
      fetch: async (url) => {
        requests.push(String(url));
        return Response.json({
          data: "https://playback.live-video.net/live.m3u8?token=guest.signed.token",
        });
      },
      liveCatalog: {
        read: async () => ({
          entries: [liveEntry("xqc", "https://playback.kick.com/bare.m3u8")],
          kind: "ready",
        }),
      },
    });
    await expect(
      source.resolve({ signal: new AbortController().signal, target }),
    ).resolves.toMatchObject({
      kind: "resolved",
      requestHeaders: {
        Origin: "https://kick.com",
        Referer: "https://kick.com/",
      },
      sourceUri:
        "https://playback.live-video.net/live.m3u8?token=guest.signed.token",
    });
    expect(requests).toEqual([
      "https://kick.com/api/v2/channels/xqc/playback-url",
    ]);
  });

  it("resolves signed guest playback for a deep link without catalog data", async () => {
    const source = createKickLivePlaybackSource({
      fetch: async () =>
        Response.json({
          data: "https://playback.live-video.net/deep.m3u8?token=guest.signed.token",
        }),
    });
    await expect(
      source.resolve({ signal: new AbortController().signal, target }),
    ).resolves.toMatchObject({
      kind: "resolved",
      sourceUri:
        "https://playback.live-video.net/deep.m3u8?token=guest.signed.token",
    });
  });

  it.each([
    { data: "http://playback.kick.com/unsigned.m3u8" },
    { data: "https://playback.kick.com/watch" },
    { data: 42 },
    { unexpected: "payload" },
  ])(
    "keeps the catalog fallback when signing returns invalid data %j",
    async (payload) => {
      const source = createKickLivePlaybackSource({
        fetch: async () => Response.json(payload),
        liveCatalog: {
          read: async () => ({
            entries: [
              liveEntry("xqc", "https://playback.kick.com/catalog.m3u8"),
            ],
            kind: "ready",
          }),
        },
      });
      await expect(
        source.resolve({ signal: new AbortController().signal, target }),
      ).resolves.toMatchObject({
        kind: "resolved",
        sourceUri: "https://playback.kick.com/catalog.m3u8",
      });
    },
  );

  it.each(["request", "parse"])(
    "stops all fallback when cancelled during signing %s",
    async (stage) => {
      const controller = new AbortController();
      const requests: string[] = [];
      const source = createKickLivePlaybackSource({
        fetch: async (url) => {
          requests.push(String(url));
          const response = Response.json({
            data: "https://playback.live-video.net/live.m3u8?token=guest.signed.token",
          });
          if (stage === "request") controller.abort();
          else {
            response.json = async () => {
              controller.abort();
              return {
                data: "https://playback.live-video.net/live.m3u8?token=guest.signed.token",
              };
            };
          }
          return response;
        },
        liveCatalog: {
          read: async () => ({
            entries: [
              liveEntry("xqc", "https://playback.kick.com/catalog.m3u8"),
            ],
            kind: "ready",
          }),
        },
      });
      await expect(
        source.resolve({ signal: controller.signal, target }),
      ).resolves.toMatchObject({
        failure: { kind: "cancelled" },
        kind: "unavailable",
      });
      expect(requests).toEqual([
        "https://kick.com/api/v2/channels/xqc/playback-url",
      ]);
    },
  );

  it("uses the matching catalog stream's playable URL", async () => {
    const source = createKickLivePlaybackSource({
      fetch: async () => new Response(null, { status: 403 }),
      liveCatalog: {
        read: async () => ({
          entries: [
            liveEntry("other", "https://playback.kick.com/other.m3u8"),
            liveEntry("XQC", "https://playback.kick.com/catalog.m3u8"),
          ],
          kind: "ready",
        }),
      },
    });
    await expect(
      source.resolve({ signal: new AbortController().signal, target }),
    ).resolves.toMatchObject({
      integration: "kick-v1-playback-url",
      kind: "resolved",
      requestHeaders: {
        Origin: "https://kick.com",
        Referer: "https://kick.com/",
      },
      sourceUri: "https://playback.kick.com/catalog.m3u8",
    });
  });

  it.each([
    ["malformed URL", liveEntry("xqc", "http://playback.kick.com/live.m3u8")],
    ["missing URL", liveEntry("xqc", null)],
    [
      "different channel",
      liveEntry("other", "https://playback.kick.com/live.m3u8"),
    ],
  ])(
    "falls back to the channel lookup for a catalog %s",
    async (_name, entry) => {
      const source = createKickLivePlaybackSource({
        fetch: legacyLiveResponse,
        liveCatalog: {
          read: async () => ({ entries: [entry], kind: "ready" }),
        },
      });
      await expect(
        source.resolve({ signal: new AbortController().signal, target }),
      ).resolves.toMatchObject({
        kind: "resolved",
        sourceUri: "https://playback.kick.com/legacy.m3u8",
      });
    },
  );

  it("falls back after a catalog provider rejection", async () => {
    const source = createKickLivePlaybackSource({
      fetch: legacyLiveResponse,
      liveCatalog: {
        read: async () => ({
          failure: { kind: "provider-rejected", status: 403 },
          kind: "unavailable",
        }),
      },
    });
    await expect(
      source.resolve({ signal: new AbortController().signal, target }),
    ).resolves.toMatchObject({
      kind: "resolved",
      sourceUri: "https://playback.kick.com/legacy.m3u8",
    });
  });

  it("stops before a catalog read when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const source = createKickLivePlaybackSource({
      fetch: legacyLiveResponse,
      liveCatalog: {
        read: async () => ({
          entries: [liveEntry("xqc", "https://playback.kick.com/catalog.m3u8")],
          kind: "ready",
        }),
      },
    });
    await expect(
      source.resolve({ signal: controller.signal, target }),
    ).resolves.toMatchObject({
      failure: { kind: "cancelled" },
      kind: "unavailable",
    });
  });

  it("stops when cancelled while the catalog read settles", async () => {
    const controller = new AbortController();
    const source = createKickLivePlaybackSource({
      fetch: legacyLiveResponse,
      liveCatalog: {
        async read() {
          controller.abort();
          return {
            entries: [
              liveEntry("xqc", "https://playback.kick.com/catalog.m3u8"),
            ],
            kind: "ready",
          };
        },
      },
    });
    await expect(
      source.resolve({ signal: controller.signal, target }),
    ).resolves.toMatchObject({
      failure: { kind: "cancelled" },
      kind: "unavailable",
    });
  });

  it("does not fall back when the catalog returns cancellation", async () => {
    const source = createKickLivePlaybackSource({
      fetch: legacyLiveResponse,
      liveCatalog: {
        read: async () => ({
          failure: { kind: "cancelled" },
          kind: "unavailable",
        }),
      },
    });
    await expect(
      source.resolve({ signal: new AbortController().signal, target }),
    ).resolves.toMatchObject({
      failure: { kind: "cancelled" },
      kind: "unavailable",
    });
  });

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

function liveEntry(
  channelName: string,
  playbackUrl: string | null,
): LiveStreamCatalogEntry {
  return {
    channel: {
      avatarUrl: "",
      displayName: channelName,
      id: channelName,
      isLive: true,
      isPartner: false,
      isVerified: false,
      platform: "kick",
      username: channelName,
    },
    playbackUrl,
    stream: {
      channelAvatar: "",
      channelDisplayName: channelName,
      channelId: channelName,
      channelName,
      id: `stream-${channelName}`,
      isLive: true,
      language: "en",
      platform: "kick",
      startedAt: null,
      tags: [],
      thumbnailUrl: "",
      title: "Live stream",
      viewerCount: 42,
    },
  };
}

async function legacyLiveResponse(
  input: Parameters<typeof globalThis.fetch>[0],
): Promise<Response> {
  if (String(input).endsWith("/playback-url")) {
    return new Response(null, { status: 403 });
  }
  return new Response(
    JSON.stringify({
      livestream: { is_live: true },
      playback_url: "https://playback.kick.com/legacy.m3u8",
    }),
    { status: 200 },
  );
}
