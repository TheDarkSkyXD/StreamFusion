import { describe, expect, it } from "vitest";

import {
  signedOutCategoriesBodySchema,
  signedOutCategoryClipsBodySchema,
  signedOutCategoryStreamsBodySchema,
  signedOutCategoryVideosBodySchema,
  signedOutSearchBodySchema,
  signedOutTopStreamsBodySchema
} from "@streamfusion/core/relay";
import { createKickOfficialCatalog } from "../adapters/kick-official-catalog";
import { createTwitchHelixCatalog } from "../adapters/twitch-helix-catalog";

type FetchCall = {
  readonly init: RequestInit | undefined;
  readonly url: string;
};

function fakeFetch(responses: ReadonlyMap<string, unknown>) {
  const calls: FetchCall[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push({ init, url });
    const body = responses.get(url);
    return body === undefined
      ? new Response(null, { status: 404 })
      : new Response(JSON.stringify(body), { status: 200 });
  };
  return { calls, fetch };
}

async function nonNull<T>(value: Promise<T | null>): Promise<T> {
  const resolved = await value;
  if (resolved === null) throw new Error("Expected an upstream response");
  return resolved;
}

describe("provider discovery catalogs", () => {
  it("maps and strips Twitch Helix responses with one cached app token", async () => {
    const upstream = fakeFetch(
      new Map([
        [
          "https://id.twitch.tv/oauth2/token",
          { access_token: "twitch-app-token", expires_in: 3_600 }
        ],
        [
          "https://api.twitch.tv/helix/streams?first=20",
          {
            data: [
              {
                game_id: "509658",
                game_name: "Just Chatting",
                id: "stream-1",
                language: "en",
                provider_only: "discard",
                thumbnail_url: "https://cdn.test/{width}x{height}.jpg",
                title: "Hello",
                type: "live",
                user_id: "user-1",
                user_login: "streamer",
                user_name: "Streamer",
                viewer_count: 42
              }
            ],
            pagination: { cursor: "cursor-1" }
          }
        ],
        [
          "https://api.twitch.tv/helix/games/top?first=20",
          {
            data: [
              {
                box_art_url: "https://cdn.test/{width}x{height}.jpg",
                id: "509658",
                name: "Just Chatting",
                provider_only: "discard"
              }
            ]
          }
        ],
        [
          "https://api.twitch.tv/helix/search/channels?first=20&query=arcade",
          {
            data: [
              {
                broadcaster_login: "streamer",
                broadcaster_type: "partner",
                display_name: "Streamer",
                id: "user-1",
                is_live: true,
                provider_only: "discard",
                thumbnail_url: "https://cdn.test/avatar.jpg"
              }
            ]
          }
        ],
        [
          "https://api.twitch.tv/helix/search/categories?first=20&query=arcade",
          {
            data: [
              {
                box_art_url: "https://cdn.test/{width}x{height}.jpg",
                id: "509658",
                name: "Just Chatting",
                provider_only: "discard"
              }
            ]
          }
        ]
      ])
    );
    const catalog = createTwitchHelixCatalog({
      credentials: {
        clientId: "twitch-client",
        clientSecret: ["twitch", "secret"].join("-")
      },
      fetch: upstream.fetch
    });
    const top = await nonNull(catalog.topStreams());
    const categories = await nonNull(catalog.categories());
    const search = await nonNull(catalog.search({ query: "arcade" }));

    expect(signedOutTopStreamsBodySchema.is(top)).toBe(true);
    expect(signedOutCategoriesBodySchema.is(categories)).toBe(true);
    expect(signedOutSearchBodySchema.is(search)).toBe(true);
    expect(top.streams[0]).toEqual({
      categoryId: "509658",
      categoryName: "Just Chatting",
      channelAvatar: "",
      channelDisplayName: "Streamer",
      channelId: "user-1",
      channelName: "streamer",
      id: "stream-1",
      isLive: true,
      language: "en",
      platform: "twitch",
      startedAt: null,
      tags: [],
      thumbnailUrl: "https://cdn.test/640x360.jpg",
      title: "Hello",
      viewerCount: 42
    });
    expect(top.streams[0]).not.toHaveProperty("provider_only");
    expect(
      upstream.calls.filter(
        (call) => call.url === "https://id.twitch.tv/oauth2/token"
      )
    ).toHaveLength(1);
    const streamCall = upstream.calls.find((call) =>
      call.url.includes("/helix/streams")
    );
    expect(new Headers(streamCall?.init?.headers).get("Client-Id")).toBe(
      "twitch-client"
    );
    expect(new Headers(streamCall?.init?.headers).get("Authorization")).toBe(
      "Bearer twitch-app-token"
    );
  });

  it("maps and strips official Kick catalog responses", async () => {
    const upstream = fakeFetch(
      new Map([
        [
          "https://id.kick.com/oauth/token",
          { access_token: "kick-app-token", expires_in: 3_600 }
        ],
        [
          "https://api.kick.com/public/v1/livestreams?limit=20",
          {
            data: [
              {
                category: { id: 4, name: "Just Chatting" },
                channel: {
                  id: 3,
                  slug: "streamer",
                  user: {
                    profile_pic: "https://cdn.test/avatar.jpg",
                    username: "Streamer"
                  }
                },
                id: 2,
                language: "en",
                provider_only: "discard",
                session_title: "Hello",
                thumbnail_url: "https://cdn.test/thumb.jpg",
                viewer_count: 42
              }
            ]
          }
        ],
        [
          "https://api.kick.com/public/v2/categories?limit=20",
          {
            data: [
              {
                id: 4,
                name: "Just Chatting",
                provider_only: "discard",
                thumbnail_url: "https://cdn.test/box.jpg",
                viewers: 42
              }
            ]
          }
        ],
        [
          "https://api.kick.com/public/v1/channels?slug%5B%5D=arcade",
          {
            data: [
              {
                id: 3,
                is_live: true,
                is_partner: true,
                provider_only: "discard",
                slug: "streamer",
                user: {
                  profile_pic: "https://cdn.test/avatar.jpg",
                  username: "Streamer"
                },
                verified: true
              }
            ]
          }
        ],
        [
          "https://api.kick.com/public/v1/categories?q=arcade",
          {
            data: [
              {
                id: 4,
                name: "Just Chatting",
                provider_only: "discard",
                thumbnail_url: "https://cdn.test/box.jpg"
              }
            ]
          }
        ]
      ])
    );
    const catalog = createKickOfficialCatalog({
      credentials: {
        clientId: "kick-client",
        clientSecret: ["kick", "secret"].join("-")
      },
      fetch: upstream.fetch
    });
    const top = await nonNull(catalog.topStreams());
    const categories = await nonNull(catalog.categories());
    const search = await nonNull(catalog.search({ query: "arcade" }));

    expect(signedOutTopStreamsBodySchema.is(top)).toBe(true);
    expect(signedOutCategoriesBodySchema.is(categories)).toBe(true);
    expect(signedOutSearchBodySchema.is(search)).toBe(true);
    expect(top.streams[0]).toEqual({
      categoryId: "4",
      categoryName: "Just Chatting",
      channelAvatar: "https://cdn.test/avatar.jpg",
      channelDisplayName: "Streamer",
      channelId: "3",
      channelName: "streamer",
      id: "2",
      isLive: true,
      language: "en",
      platform: "kick",
      startedAt: null,
      tags: [],
      thumbnailUrl: "https://cdn.test/thumb.jpg",
      title: "Hello",
      viewerCount: 42
    });
    expect(categories.categories[0]).not.toHaveProperty("provider_only");
    expect(
      upstream.calls.filter(
        (call) => call.url === "https://id.kick.com/oauth/token"
      )
    ).toHaveLength(1);
    expect(search.channels[0]).toEqual({
      avatarUrl: "https://cdn.test/avatar.jpg",
      displayName: "Streamer",
      id: "3",
      isLive: true,
      isPartner: true,
      isVerified: true,
      platform: "kick",
      username: "streamer"
    });
    expect(
      new Headers(
        upstream.calls.find((call) =>
          call.url.includes("/public/v1/livestreams")
        )?.init?.headers
      ).get("Authorization")
    ).toBe("Bearer kick-app-token");
    const kickClips = await nonNull(catalog.categoryClips({
      categoryId: "4",
      timeRange: "all"
    }));
    const kickVideos = await nonNull(
      catalog.categoryVideos({ categoryId: "4", sort: "recent" })
    );
    expect(signedOutCategoryClipsBodySchema.is(kickClips)).toBe(true);
    expect(signedOutCategoryVideosBodySchema.is(kickVideos)).toBe(true);
    expect(kickClips).toEqual({
      kind: "unsupported",
      platform: "kick",
      reason: "kick-clips-unsupported"
    });
    expect(kickVideos).toEqual({
      kind: "unsupported",
      platform: "kick",
      reason: "kick-videos-unsupported"
    });
    expect(
      upstream.calls.some((call) => call.url.includes("/clips"))
    ).toBe(false);
  });

  it("maps Helix category streams, clips, and recorded videos", async () => {
    const upstream = fakeFetch(
      new Map([
        [
          "https://id.twitch.tv/oauth2/token",
          { access_token: "twitch-app-token", expires_in: 3_600 }
        ],
        [
          "https://api.twitch.tv/helix/streams?first=20&game_id=509658",
          {
            data: [
              {
                game_id: "509658",
                game_name: "Just Chatting",
                id: "stream-1",
                language: "en",
                thumbnail_url: "https://cdn.test/{width}x{height}.jpg",
                title: "Hello",
                type: "live",
                user_id: "user-1",
                user_login: "streamer",
                user_name: "Streamer",
                viewer_count: 42
              }
            ]
          }
        ],
        [
          "https://api.twitch.tv/helix/clips?first=20&game_id=509658",
          {
            data: [
              {
                broadcaster_id: "user-1",
                broadcaster_name: "Streamer",
                created_at: "2026-09-11T00:00:00Z",
                creator_name: "Clipper",
                duration: 12,
                game_id: "509658",
                id: "clip-1",
                thumbnail_url: "https://cdn.test/clip.jpg",
                title: "Clip",
                url: "https://clips.twitch.tv/clip-1",
                view_count: 9
              }
            ]
          }
        ],
        [
          "https://api.twitch.tv/helix/videos?first=20&game_id=509658&sort=time",
          {
            data: [
              {
                duration: "1h2m3s",
                id: "video-1",
                published_at: "2026-09-11T00:00:00Z",
                thumbnail_url: "https://cdn.test/%{width}x%{height}.jpg",
                title: "Archive",
                type: "archive",
                url: "https://twitch.tv/videos/video-1",
                user_id: "user-1",
                user_login: "streamer",
                user_name: "Streamer",
                view_count: 20
              },
              {
                duration: "30s",
                id: "live-1",
                published_at: "2026-09-11T00:00:00Z",
                thumbnail_url: "https://cdn.test/live.jpg",
                title: "Live",
                type: "live",
                url: "https://twitch.tv/videos/live-1",
                user_id: "user-1",
                user_login: "streamer",
                user_name: "Streamer",
                view_count: 1
              }
            ]
          }
        ]
      ])
    );
    const catalog = createTwitchHelixCatalog({
      credentials: {
        clientId: "twitch-client",
        clientSecret: ["twitch", "secret"].join("-")
      },
      fetch: upstream.fetch
    });
    const streams = await nonNull(
      catalog.categoryStreams({ categoryId: "509658" })
    );
    const clips = await nonNull(
      catalog.categoryClips({ categoryId: "509658", timeRange: "all" })
    );
    const videos = await nonNull(
      catalog.categoryVideos({ categoryId: "509658", sort: "recent" })
    );
    expect(signedOutCategoryStreamsBodySchema.is(streams)).toBe(true);
    expect(signedOutCategoryClipsBodySchema.is(clips)).toBe(true);
    expect(signedOutCategoryVideosBodySchema.is(videos)).toBe(true);
    expect(clips.kind).toBe("available");
    expect(videos.kind).toBe("available");
    if (clips.kind === "available") {
      expect(clips.clips[0]).toMatchObject({
        createdAt: "2026-09-11T00:00:00.000Z",
        id: "clip-1",
        viewCount: 9
      });
    }
    if (videos.kind === "available") {
      expect(videos.videos).toHaveLength(1);
      expect(videos.videos[0]).toMatchObject({
        duration: 3723,
        id: "video-1",
        publishedAt: "2026-09-11T00:00:00.000Z",
        type: "archive"
      });
    }
  });
});
