import { describe, expect, it } from "vitest";

import { createKickOfficialReader } from "../adapters/kick/kick-official-reader";
import { createTwitchGqlGuestReader } from "../adapters/twitch/twitch-gql-guest";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

describe("search live stream pages", () => {
  it("maps actual live streams from a Twitch search channel", async () => {
    const reader = createTwitchGqlGuestReader({
      fetch: async () =>
        json({
          data: {
            searchFor: {
              channels: {
                edges: [
                  {
                    item: {
                      id: "71092938",
                      login: "xqc",
                      displayName: "xQc",
                      stream: {
                        id: "live-123",
                        title: "Live now",
                        viewersCount: 58000,
                        broadcaster: {
                          id: "71092938",
                          login: "xqc",
                          displayName: "xQc",
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        }),
    });
    const page = await reader.searchPage({ kind: "streams", query: "xqc" });
    expect(page.items).toMatchObject([
      { id: "live-123", viewerCount: 58000, title: "Live now" },
    ]);
  });

  it("keeps a real Kick channel livestream when its directory request fails", async () => {
    const reader = createKickOfficialReader({
      fetch: async (url) =>
        String(url).includes("api/search?")
          ? json({
              channels: [
                {
                  id: 411,
                  slug: "spreen",
                  isLive: true,
                  user: { username: "Spreen" },
                  livestream: {
                    id: 987,
                    is_live: true,
                    session_title: "Live now",
                    viewer_count: 58000,
                  },
                },
              ],
              categories: [],
            })
          : json({}, 503),
      readAccessToken: async () => null,
    });
    const page = await reader.searchPage({ kind: "streams", query: "spreen" });
    expect(page.status).toBe("partial");
    expect(page.items).toMatchObject([{ id: "987", viewerCount: 58000 }]);
  });
});
