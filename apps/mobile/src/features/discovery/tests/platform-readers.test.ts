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
        if (url.includes("/streams/followed")) {
          return json({
            data: [
              {
                id: "f1",
                language: "en",
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
              id: "s1",
              language: "en",
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
      path: { kind: "direct" },
      status: "complete",
    });
    await expect(reader.getCategories()).resolves.toMatchObject({
      items: [{ id: "g1", name: "Just Chatting" }],
    });
    await expect(reader.getFollowedStreams()).resolves.toMatchObject({
      items: [{ id: "f1", title: "Followed" }],
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
                platform: "twitch",
                query: "alice",
                streams: [fixtureStream("twitch", "search-1", 1)],
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
    ).resolves.toMatchObject({ items: [{ id: "search-1" }] });
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

  it("does not invent Kick clips or videos", async () => {
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
    expect(reader.unsupportedVideos()).toEqual({
      kind: "unsupported",
      platform: "kick",
      reason: "kick-videos-unsupported",
    });
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}
