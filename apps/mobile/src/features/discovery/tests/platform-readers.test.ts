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

  it("marks guest Twitch search unavailable and maps Kick guest catalogs", async () => {
    const twitch = createTwitchHelixReader({
      clientId: null,
      fetch: async () => json({}),
      readAccessToken: async () => null,
    });
    await expect(
      twitch.search({ guest: true, query: "arcade" }),
    ).resolves.toMatchObject({
      path: { reason: "guest-unavailable" },
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
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}
