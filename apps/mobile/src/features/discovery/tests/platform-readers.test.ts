import { createRelaySuccessEnvelope } from "@streamfusion/core/relay";
import { describe, expect, it } from "vitest";

import { createKickOfficialReader } from "../adapters/kick/kick-official-reader";
import { createRelaySignedOutReader } from "../adapters/relay/relay-signed-out-reader";
import { createTwitchHelixReader } from "../adapters/twitch/twitch-helix-reader";
import { fixtureStream } from "../domain/discovery-fixture";

describe("platform catalog readers", () => {
  it("maps Helix top streams, categories, and followed pages", async () => {
    const reader = createTwitchHelixReader({
      clientId: "client",
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("/games/top")) {
          return json({
            data: [
              {
                box_art_url: "https://example.com/{width}x{height}.jpg",
                id: "g1",
                name: "Just Chatting",
              },
            ],
          });
        }
        if (url.includes("/users")) {
          return json({
            data: [
              {
                broadcaster_type: "partner",
                display_name: "Alice",
                id: "u1",
                login: "alice",
              },
            ],
          });
        }
        if (url.includes("/streams/followed")) {
          return json({
            data: [
              {
                game_id: "509658",
                game_name: "Just Chatting",
                id: "f1",
                language: "en",
                tags: ["English"],
                thumbnail_url: "https://example.com/{width}x{height}.jpg",
                title: "Followed",
                type: "live",
                user_id: "u1",
                user_login: "alice",
                user_name: "Alice",
                viewer_count: 4,
              },
            ],
          });
        }
        return json({
          data: [
            {
              game_id: "509658",
              game_name: "Just Chatting",
              id: "s1",
              language: "en",
              tags: ["English", "IRL"],
              thumbnail_url: "https://example.com/{width}x{height}.jpg",
              title: "Top",
              type: "live",
              user_id: "u1",
              user_login: "alice",
              user_name: "Alice",
              viewer_count: 8,
            },
          ],
        });
      },
      readAccessToken: async () => "user",
      readUserId: async () => "u1",
    });
    await expect(reader.getTopStreams()).resolves.toMatchObject({
      items: [
        {
          categoryName: "Just Chatting",
          channelIsVerified: true,
          tags: ["English", "IRL"],
          title: "Top",
        },
      ],
      path: { kind: "direct" },
      status: "complete",
    });
    await expect(reader.getCategories()).resolves.toMatchObject({
      items: [{ id: "g1", name: "Just Chatting" }],
    });
    await expect(reader.getFollowedStreams()).resolves.toMatchObject({
      items: [{ channelIsVerified: true, tags: ["English"], title: "Followed" }],
    });
  });

  it("joins Helix Search Channels with Get Users for verified and tags", async () => {
    const urls: string[] = [];
    const reader = createTwitchHelixReader({
      clientId: "client",
      fetch: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/search/channels")) {
          return json({
            data: [
              {
                broadcaster_login: "alice",
                display_name: "Alice",
                game_id: "509658",
                game_name: "Just Chatting",
                id: "u1",
                is_live: true,
                tags: ["English"],
                thumbnail_url: "https://example.com/a.png",
                title: "Live search",
              },
            ],
          });
        }
        if (url.includes("/search/categories")) {
          return json({ data: [] });
        }
        if (url.includes("/users")) {
          return json({
            data: [
              {
                broadcaster_type: "partner",
                id: "u1",
                login: "alice",
              },
            ],
          });
        }
        return json({ data: [] });
      },
      readAccessToken: async () => "user",
    });
    await expect(reader.search({ query: "alice" })).resolves.toMatchObject({
      catalog: {
        channels: [{ id: "u1", isPartner: true, isVerified: true }],
        streams: [
          {
            channelIsVerified: true,
            tags: ["English"],
            title: "Live search",
          },
        ],
      },
      status: "complete",
    });
    expect(urls.filter((url) => url.includes("/users"))).toHaveLength(1);
  });

  it("maps signed-out Twitch GQL search and Kick public catalogs", async () => {
    const twitch = createTwitchHelixReader({
      clientId: null,
      fetch: async () => json({ data: { user: null, games: { edges: [] } } }),
      readAccessToken: async () => null,
    });
    await expect(
      twitch.search({ guest: true, query: "arcade" }),
    ).resolves.toMatchObject({
      path: { kind: "guest", platform: "twitch" },
      status: "complete",
    });
    const kick = createKickOfficialReader({
      fetch: async () => json({ data: [] }),
      readAccessToken: async () => null,
    });
    await expect(
      kick.search({ guest: true, query: "arcade" }),
    ).resolves.toMatchObject({
      path: { kind: "guest", platform: "kick" },
      status: "complete",
    });
  });

  it("maps signed-out Kick featured livestreams without a token", async () => {
    const reader = createKickOfficialReader({
      fetch: async (input) => {
        expect(String(input)).toContain("featured-livestreams");
        return json({
          data: [
            {
              id: 11,
              session_title: "Live on Kick",
              viewer_count: 9,
              thumbnail: { src: "https://example.com/kick.webp" },
              channel: {
                id: 22,
                slug: "absi",
                user: {
                  username: "Absi",
                  profilepic: "https://example.com/a.webp",
                  verified: true,
                },
              },
              custom_tags: [{ tag: "English" }],
            },
          ],
        });
      },
      readAccessToken: async () => null,
    });
    await expect(reader.getTopStreams()).resolves.toMatchObject({
      items: [
        {
          channelIsVerified: true,
          channelName: "absi",
          tags: ["English"],
          title: "Live on Kick",
        },
      ],
      path: { kind: "guest", platform: "kick" },
      status: "complete",
    });
  });

  it("does not invent a Kick followed catalog", async () => {
    const signedOut = createKickOfficialReader({
      fetch: async () => json({}),
      readAccessToken: async () => null,
    });
    await expect(signedOut.getFollowedStreams()).resolves.toMatchObject({
      path: { reason: "signed-out-login-required" },
    });
    const signedIn = createKickOfficialReader({
      fetch: async () => json({}),
      readAccessToken: async () => "user",
    });
    await expect(signedIn.getFollowedStreams()).resolves.toMatchObject({
      error: { code: "followed-unavailable" },
    });
  });

  it("parses Relay signed-out pages and rejects followed reads", async () => {
    const reader = createRelaySignedOutReader({
      baseUrl: "http://relay.test/",
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("/categories")) {
          return json(
            createRelaySuccessEnvelope({
              body: {
                categories: [
                  {
                    boxArtUrl: "https://example.com/box.png",
                    id: "g1",
                    name: "Just Chatting",
                    platform: "twitch",
                  },
                ],
                platform: "twitch",
              },
              requestId: "req_signed_out_categories_1",
            }),
          );
        }
        if (url.includes("/search")) {
          return json(
            createRelaySuccessEnvelope({
              body: {
                categories: [],
                channels: [],
                clips: [],
                platform: "twitch",
                query: "alice",
                streams: [fixtureStream("twitch", "search-1", 1)],
                videos: [],
              },
              requestId: "req_signed_out_search_1",
            }),
          );
        }
        return json(
          createRelaySuccessEnvelope({
            body: {
              platform: "twitch",
              streams: [fixtureStream("twitch", "top-1", 2)],
            },
            requestId: "req_signed_out_top_1",
          }),
        );
      },
      installation: async () => ({ credential: "install", kind: "ready" }),
    });
    await expect(
      reader.getTopStreams({ platform: "twitch" }),
    ).resolves.toMatchObject({ status: "complete" });
    await expect(
      reader.getCategories({ platform: "twitch" }),
    ).resolves.toMatchObject({ items: [{ id: "g1" }] });
    await expect(
      reader.search({ platform: "twitch", query: "alice" }),
    ).resolves.toMatchObject({
      catalog: { streams: [{ id: "search-1" }] },
    });
    await expect(
      reader.getFollowedStreams({ platform: "twitch" }),
    ).resolves.toMatchObject({
      path: { reason: "signed-out-login-required" },
    });
  });

  it("drops live Helix videos and stamps clip windows as exact ISO", async () => {
    const urls: string[] = [];
    const reader = createTwitchHelixReader({
      clientId: "client",
      fetch: async (input) => {
        urls.push(String(input));
        if (String(input).includes("/videos")) {
          return json({
            data: [
              {
                id: "live-1",
                published_at: "2026-09-11T00:00:00Z",
                thumbnail_url: "https://example.com/{width}x{height}.jpg",
                title: "Live leak",
                type: "live",
                url: "https://twitch.tv/videos/live-1",
                user_id: "u1",
                user_login: "alice",
                user_name: "Alice",
                view_count: 9,
                duration: "1h2m3s",
              },
              {
                id: "vod-1",
                published_at: "2026-09-11T00:00:00Z",
                thumbnail_url: "https://example.com/{width}x{height}.jpg",
                title: "Archive",
                type: "archive",
                url: "https://twitch.tv/videos/vod-1",
                user_id: "u1",
                user_login: "alice",
                user_name: "Alice",
                view_count: 4,
                duration: "1h2m3s",
              },
            ],
          });
        }
        return json({
          data: [
            {
              broadcaster_id: "u1",
              broadcaster_name: "Alice",
              created_at: "2026-09-11T00:00:00Z",
              creator_name: "Bob",
              duration: 12,
              id: "clip-1",
              thumbnail_url: "https://example.com/clip.jpg",
              title: "Clip",
              url: "https://clips.twitch.tv/clip-1",
              view_count: 3,
            },
          ],
        });
      },
      readAccessToken: async () => "user",
    });
    const videos = await reader.getCategoryVideos({
      categoryId: "509658",
      sort: "recent",
    });
    expect(videos.items.map((item) => item.id)).toEqual(["vod-1"]);
    expect(videos.items[0]).toMatchObject({ duration: 3723, type: "archive" });
    const clips = await reader.getCategoryClips({
      categoryId: "509658",
      timeRange: "day",
    });
    expect(clips.items[0]?.id).toBe("clip-1");
    const clipUrl = new URL(urls.find((url) => url.includes("/clips")) ?? "");
    expect(clipUrl.searchParams.get("started_at")?.endsWith("Z")).toBe(true);
    expect(clipUrl.searchParams.get("ended_at")?.endsWith("Z")).toBe(true);
    expect(clipUrl.searchParams.get("started_at")).toBe(
      new Date(clipUrl.searchParams.get("started_at") ?? "").toISOString(),
    );
  });

  it("does not invent Kick clips", async () => {
    const reader = createKickOfficialReader({
      fetch: async () => {
        throw new Error("should not fetch");
      },
      readAccessToken: async () => "user",
    });
    expect(reader.unsupportedClips()).toEqual({
      kind: "unsupported",
      platform: "kick",
      reason: "kick-clips-unsupported",
    });
  });

  // Guards: Kick public video dates without milliseconds must still map
  it("reads Kick channel videos from the public catalog", async () => {
    const urls: string[] = [];
    const reader = createKickOfficialReader({
      fetch: async (input) => {
        urls.push(String(input));
        return json([
          {
            created_at: "2026-09-01T00:00:00Z",
            duration: 61_000,
            id: 42,
            session_title: "Archive",
            source: "https://stream.kick.com/video.m3u8",
            thumbnail: { src: "https://example.com/thumb.jpg" },
            views: 9,
            video: { uuid: "u" },
          },
        ]);
      },
      readAccessToken: async () => null,
    });
    const videos = await reader.getChannelVideos({
      channel: { id: "xqc", platform: "kick", username: "xqc" },
    });
    expect(videos.status).toBe("complete");
    expect(videos.items[0]).toMatchObject({
      duration: 61,
      id: "42",
      publishedAt: "2026-09-01T00:00:00.000Z",
      title: "Archive",
      url: "https://stream.kick.com/video.m3u8",
    });
    expect(urls[0]).toContain("kick.com/api/v2/channels/xqc/videos");
  });

  // Guards: guest Twitch GQL video dates without milliseconds must still map
  it("maps guest Twitch GQL videos whose publishedAt lacks milliseconds", async () => {
    const reader = createTwitchHelixReader({
      clientId: null,
      fetch: async () => json(gqlArchiveWithoutMillis()),
      readAccessToken: async () => null,
    });
    const videos = await reader.getChannelVideos({
      channel: { id: "71092938", platform: "twitch", username: "xqc" },
    });
    expect(videos.status).toBe("complete");
    expect(videos.items).toHaveLength(1);
    expect(videos.items[0]).toMatchObject({
      id: "2873333195",
      publishedAt: "2026-09-13T18:00:50.000Z",
      title: "Archive",
    });
  });

  // Guards: guest Twitch clips must use ClipsFilter LAST_MONTH, not an invalid MONTH period
  it("requests guest Twitch channel clips with LAST_MONTH filter", async () => {
    const bodies: unknown[] = [];
    const reader = createTwitchHelixReader({
      clientId: null,
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")));
        return json(gqlClips());
      },
      readAccessToken: async () => null,
    });
    const clips = await reader.getChannelClips({
      channel: { id: "71092938", platform: "twitch", username: "xqc" },
    });
    expect(bodies[0]).toMatchObject({
      query: expect.stringContaining("$criteria:ClipsFilter"),
      variables: { criteria: "LAST_MONTH", limit: 20, login: "xqc" },
    });
    expect(clips.status).toBe("complete");
    expect(clips.items[0]).toMatchObject({
      duration: 7,
      id: "AbstemiousSillyPuppyBCouch-x_zVHj6Yc6UvUVuu",
      title: "Me on stream",
    });
  });
});

function gqlArchiveWithoutMillis(): unknown {
  return {
    data: {
      user: {
        displayName: "xQc",
        id: "71092938",
        login: "xqc",
        profileImageURL: "https://example.com/xqc.png",
        videos: {
          edges: [
            {
              node: {
                broadcastType: "ARCHIVE",
                id: "2873333195",
                lengthSeconds: 43743,
                owner: {
                  displayName: "xQc",
                  id: "71092938",
                  login: "xqc",
                  profileImageURL: "https://example.com/xqc.png",
                },
                previewThumbnailURL: "https://example.com/t.jpg",
                publishedAt: "2026-09-13T18:00:50Z",
                title: "Archive",
                viewCount: 12,
              },
            },
          ],
        },
      },
    },
  };
}

function gqlClips(): unknown {
  return {
    data: {
      user: {
        displayName: "xQc",
        id: "71092938",
        login: "xqc",
        profileImageURL: "https://example.com/xqc.png",
        clips: {
          edges: [
            {
              node: {
                broadcaster: {
                  displayName: "xQc",
                  id: "71092938",
                  login: "xqc",
                  profileImageURL: "https://example.com/xqc.png",
                },
                createdAt: "2026-09-01T00:00:00Z",
                durationSeconds: 7,
                id: "3133684469",
                slug: "AbstemiousSillyPuppyBCouch-x_zVHj6Yc6UvUVuu",
                thumbnailURL: "https://example.com/c.jpg",
                title: "Me on stream",
                url: "https://clips.twitch.tv/AbstemiousSillyPuppyBCouch-x_zVHj6Yc6UvUVuu",
                viewCount: 12,
              },
            },
          ],
        },
      },
    },
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}
