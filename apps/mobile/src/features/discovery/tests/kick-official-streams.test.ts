import { describe, expect, it } from "vitest";

import { createKickOfficialCategoryReads } from "../adapters/kick/kick-official-category-reader";
import { createKickOfficialReader } from "../adapters/kick/kick-official-reader";
import { mapKickOfficialStreams } from "../adapters/kick/kick-official-streams";
import type { LiveStreamCatalog } from "../capabilities/live-stream-catalog";

const officialStream = {
  id: "live-270",
  broadcaster_user: {
    id: 42,
    username: "Kick Creator",
    profile_picture: "https://images.example/avatar.jpg",
  },
  channel: { id: 19, slug: "kick-creator" },
  category: { id: 7, name: "Just Chatting" },
  language_code: "en",
  title: "Live conversation",
  thumbnail: "https://images.example/live.jpg",
  started_at: "2026-09-30T12:34:56Z",
  tags: ["English", "Conversation"],
  viewer_count: 1234,
};

const expectedStream = {
  categoryId: "7",
  categoryName: "Just Chatting",
  channelAvatar: "https://images.example/avatar.jpg",
  channelDisplayName: "Kick Creator",
  channelId: "42",
  channelName: "kick-creator",
  id: "live-270",
  isLive: true,
  language: "en",
  platform: "kick",
  startedAt: "2026-09-30T12:34:56.000Z",
  tags: ["English", "Conversation"],
  thumbnailUrl: "https://images.example/live.jpg",
  title: "Live conversation",
  viewerCount: 1234,
};

describe("Kick official V2 livestreams", () => {
  it("reads signed-in top streams using the desktop V2 broadcaster and category shape", async () => {
    const requests: { url: string; authorization: string | null }[] = [];
    const reader = createKickOfficialReader({
      fetch: async (url, init) => {
        requests.push({
          authorization: new Headers(init?.headers).get("Authorization"),
          url: String(url),
        });
        return Response.json({ data: [officialStream] });
      },
      readAccessToken: async () => "user-token",
    });

    const outcome = await reader.getTopStreams();

    expect(requests).toEqual([
      {
        authorization: "Bearer user-token",
        url: "https://api.kick.com/public/v2/livestreams?limit=20",
      },
    ]);
    expect(outcome.status).toBe("complete");
    expect(outcome.path).toEqual({ kind: "direct", platform: "kick" });
    expect(outcome.items).toEqual([expectedStream]);
  });

  it("reads signed-in category streams using V2 and language_code", async () => {
    const urls: string[] = [];
    const reader = createKickOfficialCategoryReads({
      fetch: async (url) => {
        urls.push(String(url));
        return Response.json({ data: [officialStream] });
      },
      readAccessToken: async () => "user-token",
    });

    const outcome = await reader.getCategoryStreams({
      categoryId: "7",
      language: "en",
    });

    expect(urls).toEqual([
      "https://api.kick.com/public/v2/livestreams?category_id=7&limit=20&language_code=en",
    ]);
    expect(outcome.items).toEqual([expectedStream]);
  });

  it("requests and keeps only the selected language for top streams", async () => {
    const urls: string[] = [];
    const reader = createKickOfficialReader({
      fetch: async (url) => {
        urls.push(String(url));
        return Response.json({
          data: [
            officialStream,
            { ...officialStream, id: "live-tl", language_code: "tl" },
          ],
        });
      },
      readAccessToken: async () => "user-token",
    });
    const outcome = await reader.getTopStreams({ language: "tl" });
    expect(urls).toEqual([
      "https://api.kick.com/public/v2/livestreams?limit=20&language_code=tl",
    ]);
    expect(outcome.items.map((stream) => stream.id)).toEqual(["live-tl"]);
  });

  it("filters the guest live directory by selected language", async () => {
    const streams = mapKickOfficialStreams({
      data: [
        officialStream,
        { ...officialStream, id: "live-tl", language_code: "tl" },
      ],
    });
    const liveCatalog: LiveStreamCatalog = {
      async read() {
        return {
          kind: "ready",
          entries: streams.map((stream) => ({
            stream,
            channel: {
              avatarUrl: stream.channelAvatar,
              displayName: stream.channelDisplayName,
              id: stream.channelId,
              isLive: true,
              isPartner: false,
              isVerified: false,
              platform: "kick",
              username: stream.channelName,
            },
            playbackUrl: null,
          })),
        };
      },
    };
    const reader = createKickOfficialReader({
      fetch: async () => {
        throw new Error("Guest directory should supply streams");
      },
      liveCatalog,
      readAccessToken: async () => null,
    });
    const outcome = await reader.getTopStreams({ language: "tl" });
    expect(outcome.items.map((stream) => stream.id)).toEqual(["live-tl"]);
  });

  it("rejects records with no usable stream ID, channel slug, or broadcaster identity", () => {
    expect(
      mapKickOfficialStreams({
        data: [
          { ...officialStream, id: undefined },
          { ...officialStream, channel: { id: 19 } },
          { ...officialStream, channel: { slug: "  " } },
          {
            ...officialStream,
            channel: { slug: "kick-creator" },
            broadcaster_user: {},
          },
          null,
          [],
        ],
      }),
    ).toEqual([]);
  });

  it("keeps invalid optional dates and viewer counts out of the normalized stream", () => {
    const items = mapKickOfficialStreams({
      data: [
        {
          ...officialStream,
          started_at: "invalid-date",
          viewer_count: Infinity,
        },
      ],
    });
    expect(items[0]?.startedAt).toBeNull();
    expect(items[0]?.viewerCount).toBe(0);
  });

  it("reads guest category streams from the paged category endpoint", async () => {
    const urls: string[] = [];
    const reader = createKickOfficialCategoryReads({
      fetch: async (url) => {
        urls.push(String(url));
        return Response.json({
          data: {
            livestreams: [
              {
                id: "web-live",
                title: "Live conversation",
                viewer_count: 12,
                channel: {
                  id: 19,
                  slug: "kick-creator",
                  username: "Kick Creator",
                },
                category: { id: 7, name: "Just Chatting" },
                language: "en",
              },
            ],
            pagination: { next_cursor: "next" },
          },
        });
      },
      readAccessToken: async () => null,
    });
    const outcome = await reader.getCategoryStreams({
      categoryId: "7",
      language: "en",
    });
    expect(urls).toEqual([
      "https://web.kick.com/api/v1/livestreams?limit=24&sort=viewer_count_desc&category_id=7",
    ]);
    expect(outcome.items.map((stream) => stream.id)).toEqual(["web-live"]);
    expect(outcome.cursor).toBe("next");
  });

  it("does not publish a guest response that arrives after cancellation", async () => {
    const controller = new AbortController();
    const reader = createKickOfficialCategoryReads({
      fetch: async () => {
        controller.abort();
        return Response.json({ data: { livestreams: [], pagination: {} } });
      },
      readAccessToken: async () => null,
    });
    const outcome = await reader.getCategoryStreams({
      categoryId: "7",
      signal: controller.signal,
    });
    expect(outcome.error).toEqual({ code: "cancelled", retry: "none" });
    expect(outcome.path).toEqual({
      kind: "unavailable",
      platform: "kick",
      reason: "cancelled",
    });
  });

  it("does not publish a signed-in response that arrives after cancellation", async () => {
    const controller = new AbortController();
    const reader = createKickOfficialCategoryReads({
      fetch: async () => {
        controller.abort();
        return Response.json({ data: [officialStream] });
      },
      readAccessToken: async () => "user-token",
    });

    const outcome = await reader.getCategoryStreams({
      categoryId: "7",
      signal: controller.signal,
    });

    expect(outcome.items).toEqual([]);
    expect(outcome.error).toEqual({ code: "cancelled", retry: "none" });
  });
});
