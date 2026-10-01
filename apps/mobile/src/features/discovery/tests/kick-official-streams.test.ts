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

  it("uses matching guest catalog streams and falls back for categories outside the catalog", async () => {
    const streams = mapKickOfficialStreams({ data: [officialStream] });
    const stream = streams[0];
    if (!stream) throw new Error("Expected normalized stream");
    const liveCatalog: LiveStreamCatalog = {
      async read() {
        return {
          kind: "ready",
          entries: [
            {
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
            },
          ],
        };
      },
    };
    const urls: string[] = [];
    const reader = createKickOfficialCategoryReads({
      fetch: async (url) => {
        urls.push(String(url));
        return Response.json([
          {
            id: "legacy-live",
            channel: {
              id: 51,
              slug: "legacy-creator",
              user: { username: "Legacy Creator" },
            },
            categories: [{ id: 8, name: "Legacy Category" }],
            language: "en",
            session_title: "Legacy category stream",
            viewer_count: 5,
          },
          {
            id: "french-live",
            channel: {
              id: 52,
              slug: "french-creator",
              user: { username: "French Creator" },
            },
            categories: [{ id: 7, name: "Just Chatting" }],
            language: "fr",
            session_title: "French category stream",
            viewer_count: 6,
          },
        ]);
      },
      liveCatalog,
      readAccessToken: async () => null,
    });

    const outcome = await reader.getCategoryStreams({
      categoryId: "7",
      language: "en",
    });
    expect(outcome.path).toEqual({ kind: "guest", platform: "kick" });
    expect(outcome.items).toEqual([expectedStream]);
    expect(urls).toEqual([]);

    const fallback = await reader.getCategoryStreams({ categoryId: "8" });
    expect(urls).toEqual([
      "https://kick.com/stream/featured-livestreams/en",
      "https://kick.com/stream/livestreams/en",
    ]);
    expect(fallback.status).toBe("complete");
    expect(fallback.items).toEqual([
      expect.objectContaining({
        categoryId: "8",
        channelName: "legacy-creator",
        id: "legacy-live",
        title: "Legacy category stream",
      }),
    ]);

    const languageFallback = await reader.getCategoryStreams({
      categoryId: "7",
      language: "fr",
    });
    expect(urls).toHaveLength(4);
    expect(languageFallback.items).toEqual([
      expect.objectContaining({
        categoryId: "7",
        channelName: "french-creator",
        id: "french-live",
        language: "fr",
      }),
    ]);
  });

  it("does not fall back to public requests when catalog reading is cancelled", async () => {
    const reader = createKickOfficialCategoryReads({
      fetch: async () => {
        throw new Error("Cancelled reads must not fetch fallback data");
      },
      liveCatalog: {
        read: async () => ({
          kind: "unavailable",
          failure: { kind: "cancelled" },
        }),
      },
      readAccessToken: async () => null,
    });

    const outcome = await reader.getCategoryStreams({ categoryId: "7" });

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
