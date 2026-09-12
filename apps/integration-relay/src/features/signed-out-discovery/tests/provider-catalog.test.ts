import { describe, expect, it } from "vitest";

import {
  signedOutCategoriesBodySchema,
  signedOutChannelBodySchema,
  signedOutClipsBodySchema,
  signedOutSearchBodySchema,
  signedOutTopStreamsBodySchema,
  signedOutVideosBodySchema
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
  });

  it("maps Twitch channel videos and marks Kick media unsupported", async () => {
    const twitchUpstream = fakeFetch(
      new Map([
        [
          "https://id.twitch.tv/oauth2/token",
          { access_token: "twitch-app-token", expires_in: 3_600 }
        ],
        [
          "https://api.twitch.tv/helix/users?login=alice",
          {
            data: [
              {
                broadcaster_type: "partner",
                created_at: "2020-01-01T00:00:00Z",
                description: "Hello",
                display_name: "Alice",
                id: "c1",
                login: "alice",
                profile_image_url: "https://cdn.test/a.png"
              }
            ]
          }
        ],
        [
          "https://api.twitch.tv/helix/channels?broadcaster_id=c1",
          {
            data: [
              {
                game_id: "509658",
                game_name: "Just Chatting",
                title: "Live now"
              }
            ]
          }
        ],
        ["https://api.twitch.tv/helix/streams?user_id=c1", { data: [] }],
        [
          "https://api.twitch.tv/helix/videos?first=20&user_id=c1",
          {
            data: [
              {
                created_at: "2026-09-11T00:00:00Z",
                duration: "1h2m3s",
                id: "v1",
                published_at: "2026-09-11T00:00:00Z",
                thumbnail_url: "https://cdn.test/%{width}x%{height}.jpg",
                title: "Yesterday",
                type: "archive",
                url: "https://twitch.tv/videos/v1",
                view_count: 8
              }
            ]
          }
        ],
        [
          "https://api.twitch.tv/helix/clips?broadcaster_id=c1&first=20",
          {
            data: [
              {
                created_at: "2026-09-11T00:00:00Z",
                creator_name: "bob",
                duration: 20,
                id: "clip1",
                thumbnail_url: "https://cdn.test/c.png",
                title: "Clip",
                url: "https://clips.twitch.tv/clip1",
                view_count: 4
              }
            ]
          }
        ]
      ])
    );
    const twitch = createTwitchHelixCatalog({
      credentials: {
        clientId: "twitch-client",
        clientSecret: ["twitch", "secret"].join("-")
      },
      fetch: twitchUpstream.fetch
    });
    const channel = await nonNull(twitch.channel({ login: "alice" }));
    const videos = await nonNull(twitch.videos({ login: "alice" }));
    const clips = await nonNull(twitch.clips({ login: "alice" }));
    expect(signedOutChannelBodySchema.is(channel)).toBe(true);
    expect(signedOutVideosBodySchema.is(videos)).toBe(true);
    expect(signedOutClipsBodySchema.is(clips)).toBe(true);
    expect(channel.live).toBeNull();
    expect(videos.videos[0]?.duration).toBe(3723);
    expect(clips.clips[0]?.creatorName).toBe("bob");

    const kick = createKickOfficialCatalog({
      credentials: {
        clientId: "kick-client",
        clientSecret: ["kick", "secret"].join("-")
      },
      fetch: async () => new Response(null, { status: 500 })
    });
    const kickVideos = await nonNull(kick.videos({ login: "alice" }));
    const kickClips = await nonNull(kick.clips({ login: "alice" }));
    expect(signedOutVideosBodySchema.is(kickVideos)).toBe(true);
    expect(signedOutClipsBodySchema.is(kickClips)).toBe(true);
    expect(kickVideos.support).toBe("unsupported");
    expect(kickClips.support).toBe("unsupported");
  });
});
