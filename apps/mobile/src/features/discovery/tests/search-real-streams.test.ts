import { describe, expect, it } from "vitest";

import { createKickOfficialReader } from "../adapters/kick/kick-official-reader";
import { createTwitchGqlGuestReader } from "../adapters/twitch/twitch-gql-guest";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

describe("guest search live streams", () => {
  it("hydrates Twitch viewer counts from the channel detail read", async () => {
    const reader = createTwitchGqlGuestReader({
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { query: string };
        if (body.query.includes("GetTopGames")) {
          return json({ data: { games: { edges: [] } } });
        }
        return json({
          data: {
            user: {
              id: "71092938",
              login: "xqc",
              displayName: "xQc",
              profileImageURL: "",
              stream: body.query.includes("viewersCount")
                ? { id: "live-123", title: "Live now", viewersCount: 58000 }
                : { id: "live-123" },
            },
          },
        });
      },
    });
    const search = await reader.search({ query: "xqc" });
    expect(search.catalog.channels).toMatchObject([
      { id: "71092938", isLive: true },
    ]);
    expect(search.catalog.streams).toMatchObject([
      { id: "live-123", viewerCount: 58000, title: "Live now" },
    ]);
  });

  it("keeps the Twitch channel when its live detail read fails", async () => {
    const reader = createTwitchGqlGuestReader({
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { query: string };
        if (body.query.includes("GetTopGames")) {
          return json({ data: { games: { edges: [] } } });
        }
        if (body.query.includes("viewersCount")) return json({}, 503);
        return json({
          data: {
            user: {
              id: "71092938",
              login: "xqc",
              displayName: "xQc",
              profileImageURL: "",
              stream: { id: "live-123" },
            },
          },
        });
      },
    });
    const search = await reader.search({ query: "xqc" });
    expect(search.status).toBe("complete");
    expect(search.catalog.channels).toMatchObject([
      { id: "71092938", isLive: true },
    ]);
    expect(search.catalog.streams).toEqual([]);
  });

  it("uses the Kick live catalog count for a guest channel match", async () => {
    const reader = createKickOfficialReader({
      fetch: async (input) => {
        expect(String(input)).toContain("/subcategories");
        return json({ data: [] });
      },
      liveCatalog: {
        read: async () => ({
          kind: "ready",
          entries: [
            {
              channel: {
                avatarUrl: "",
                displayName: "Spreen",
                id: "411",
                isLive: true,
                isPartner: false,
                isVerified: false,
                platform: "kick",
                username: "spreen",
              },
              playbackUrl: null,
              stream: {
                channelAvatar: "",
                channelDisplayName: "Spreen",
                channelId: "411",
                channelName: "spreen",
                id: "kick-live-1",
                isLive: true,
                language: "es",
                platform: "kick",
                startedAt: null,
                tags: [],
                thumbnailUrl: "",
                title: "Live now",
                viewerCount: 58000,
              },
            },
          ],
        }),
      },
      readAccessToken: async () => null,
    });
    const search = await reader.search({ guest: true, query: "spreen" });
    expect(search.catalog.channels).toMatchObject([{ username: "spreen" }]);
    expect(search.catalog.streams).toMatchObject([
      { id: "kick-live-1", viewerCount: 58000 },
    ]);
  });

  it("uses the public Kick channel stream when the directory is unavailable", async () => {
    const reader = createKickOfficialReader({
      fetch: async (input) =>
        String(input).includes("/subcategories")
          ? json({ data: [] })
          : json({
              id: 411,
              slug: "spreen",
              user: { username: "Spreen" },
              livestream: {
                id: 987,
                is_live: true,
                session_title: "Live now",
                viewer_count: 58000,
              },
            }),
      liveCatalog: {
        read: async () => ({
          failure: { kind: "provider-rejected", status: 503 },
          kind: "unavailable",
        }),
      },
      readAccessToken: async () => null,
    });
    const search = await reader.search({ guest: true, query: "spreen" });
    expect(search.catalog.channels).toMatchObject([{ username: "spreen" }]);
    expect(search.catalog.streams).toMatchObject([
      { id: "987", viewerCount: 58000 },
    ]);
  });
});
