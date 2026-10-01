import { describe, expect, it } from "vitest";

import { createKickLiveCatalog } from "../adapters/kick/kick-live-catalog";
import { createKickOfficialReader } from "../adapters/kick/kick-official-reader";

const payload = {
  status: "success",
  data: {
    livestreams: [
      {
        id: "livestream_01M3TBK28YTZS266DHWTVQF94E",
        streamer: {
          user: {
            id: "user_01JP5THMS0YXJYK85PYSQJCSE8",
            username: "YoloAventuras",
            is_verified: true,
            profile_picture: "https://files.kick.com/avatar.webp",
          },
          channel: {
            id: "channel_01JP5THMW3VV5JDS27S0J8Z9PW",
            slug: "yoloaventuras",
            banner_picture: "https://files.kick.com/banner.webp",
            description: "Adventures live.",
          },
        },
        metadata: {
          title: "NANDO SID YA NO VOLVERÁ JAMÁS !!",
          language: "es",
          has_mature_content: false,
          category: { id: "category_01K03MKV015TB8SG22MK1DAHC8", name: "IRL" },
        },
        viewers_count: 103420,
        playback_url: "https://playback.live-video.net/yolo.m3u8",
        thumbnail_url: "https://images.kick.com/yolo.webp",
        started_at: "2026-09-30T23:49:55Z",
      },
    ],
    next_cursor: "next",
  },
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

describe("Kick live catalog", () => {
  it("reads the desktop directory into populated cards and their playable source", async () => {
    const catalog = createKickLiveCatalog({ fetch: async () => json(payload) });
    await expect(catalog.read({})).resolves.toEqual({
      kind: "ready",
      entries: [
        {
          channel: {
            avatarUrl: "https://files.kick.com/avatar.webp",
            bannerUrl: "https://files.kick.com/banner.webp",
            bio: "Adventures live.",
            categoryId: "category_01K03MKV015TB8SG22MK1DAHC8",
            categoryName: "IRL",
            displayName: "YoloAventuras",
            id: "channel_01JP5THMW3VV5JDS27S0J8Z9PW",
            isLive: true,
            isPartner: false,
            isVerified: true,
            lastStreamTitle: "NANDO SID YA NO VOLVERÁ JAMÁS !!",
            platform: "kick",
            username: "yoloaventuras",
          },
          playbackUrl: "https://playback.live-video.net/yolo.m3u8",
          stream: {
            categoryId: "category_01K03MKV015TB8SG22MK1DAHC8",
            categoryName: "IRL",
            channelAvatar: "https://files.kick.com/avatar.webp",
            channelDisplayName: "YoloAventuras",
            channelId: "channel_01JP5THMW3VV5JDS27S0J8Z9PW",
            channelIsVerified: true,
            channelName: "yoloaventuras",
            id: "livestream_01M3TBK28YTZS266DHWTVQF94E",
            isLive: true,
            isMature: false,
            language: "es",
            platform: "kick",
            startedAt: "2026-09-30T23:49:55.000Z",
            tags: [],
            thumbnailUrl: "https://images.kick.com/yolo.webp",
            title: "NANDO SID YA NO VOLVERÁ JAMÁS !!",
            viewerCount: 103420,
          },
        },
      ],
    });
  });

  it("shares fresh data with channel inspection and refreshes it after expiry", async () => {
    let now = 0;
    let calls = 0;
    const catalog = createKickLiveCatalog({
      fetch: async () => {
        calls += 1;
        return json({
          ...payload,
          data: {
            livestreams: [
              { ...payload.data.livestreams[0], viewers_count: calls },
            ],
          },
        });
      },
      nowEpochMs: () => now,
    });
    const reader = createKickOfficialReader({
      fetch: async () => {
        throw new Error("legacy unavailable");
      },
      liveCatalog: catalog,
      readAccessToken: async () => null,
    });
    const top = await reader.getTopStreams();
    expect(top.items[0]?.channelName).toBe("yoloaventuras");
    now = 29_999;
    const channel = await reader.getChannel({
      channel: { id: "unknown", platform: "kick", username: "YoloAventuras" },
    });
    expect(channel).toMatchObject({
      channel: { username: "yoloaventuras" },
      live: { viewerCount: 1 },
      status: "complete",
    });
    now = 30_000;
    expect(await reader.getTopStreams()).toMatchObject({
      items: [{ viewerCount: 2 }],
      status: "complete",
    });
  });

  it("lets cancellation win over a warm snapshot and completed fetch", async () => {
    const catalog = createKickLiveCatalog({ fetch: async () => json(payload) });
    expect(await catalog.read({})).toMatchObject({ kind: "ready" });
    const aborted = new AbortController();
    aborted.abort();
    expect(await catalog.read({ signal: aborted.signal })).toEqual({
      kind: "unavailable",
      failure: { kind: "cancelled" },
    });
    const pending = new AbortController();
    const cancelling = createKickLiveCatalog({
      fetch: async () => {
        pending.abort();
        return json(payload);
      },
    });
    expect(await cancelling.read({ signal: pending.signal })).toEqual({
      kind: "unavailable",
      failure: { kind: "cancelled" },
    });
  });

  it("rejects malformed data without caching a successful empty catalog", async () => {
    let calls = 0;
    const catalog = createKickLiveCatalog({
      fetch: async () =>
        json(
          ++calls === 1
            ? { data: { livestreams: [{ id: "broken" }] } }
            : payload,
        ),
    });
    expect(await catalog.read({})).toEqual({
      kind: "unavailable",
      failure: { kind: "invalid-response" },
    });
    expect(await catalog.read({})).toMatchObject({
      kind: "ready",
      entries: [{ stream: { channelName: "yoloaventuras" } }],
    });
  });

  it("falls back to legacy featured data after a rejected directory request", async () => {
    const reader = createKickOfficialReader({
      fetch: async (url) =>
        String(url).includes("private/v1")
          ? new Response("blocked", { status: 403 })
          : json({
              data: [
                {
                  id: 7,
                  channel: {
                    id: 8,
                    slug: "legacy",
                    user: { username: "Legacy" },
                  },
                  session_title: "Legacy live",
                  viewer_count: 9,
                },
              ],
            }),
      readAccessToken: async () => null,
    });
    expect(await reader.getTopStreams()).toMatchObject({
      items: [{ channelName: "legacy", title: "Legacy live", viewerCount: 9 }],
      status: "complete",
    });
  });

  it("does not turn catalogue cancellation into a legacy request", async () => {
    const reader = createKickOfficialReader({
      fetch: async () =>
        json({ data: [{ id: 7, channel: { slug: "wrong" } }] }),
      liveCatalog: {
        read: async () => ({
          kind: "unavailable",
          failure: { kind: "cancelled" },
        }),
      },
      readAccessToken: async () => null,
    });
    expect(await reader.getTopStreams()).toMatchObject({
      error: { code: "cancelled", retry: "none" },
      items: [],
      status: "failed",
    });
  });

  it("preserves a real empty directory and missing playback source", async () => {
    const empty = createKickLiveCatalog({
      fetch: async () => json({ data: { livestreams: [] } }),
    });
    expect(await empty.read({})).toEqual({ kind: "ready", entries: [] });
    const noSource = createKickLiveCatalog({
      fetch: async () =>
        json({
          data: {
            livestreams: [
              { ...payload.data.livestreams[0], playback_url: null },
            ],
          },
        }),
    });
    expect(await noSource.read({})).toMatchObject({
      kind: "ready",
      entries: [
        { playbackUrl: null, stream: { channelName: "yoloaventuras" } },
      ],
    });
  });

  it("does not publish catalog data that settles after cancellation", async () => {
    const controller = new AbortController();
    const reader = createKickOfficialReader({
      fetch: async () => json(payload),
      liveCatalog: {
        read: async () => {
          controller.abort();
          return { kind: "ready", entries: [] };
        },
      },
      readAccessToken: async () => null,
    });
    expect(
      await reader.getTopStreams({ signal: controller.signal }),
    ).toMatchObject({
      status: "failed",
      error: { code: "cancelled", retry: "none" },
      path: { kind: "unavailable", reason: "cancelled" },
    });
  });

  it("distinguishes network failures and provider rejection", async () => {
    const offline = createKickLiveCatalog({
      fetch: async () => {
        throw new TypeError("Network request failed");
      },
    });
    expect(await offline.read({})).toEqual({
      kind: "unavailable",
      failure: { kind: "offline" },
    });
    const rejected = createKickLiveCatalog({
      fetch: async () => new Response("busy", { status: 503 }),
    });
    expect(await rejected.read({})).toEqual({
      kind: "unavailable",
      failure: { kind: "provider-rejected", status: 503 },
    });
  });
});
