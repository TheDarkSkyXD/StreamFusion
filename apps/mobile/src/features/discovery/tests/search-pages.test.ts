import { describe, expect, it } from "vitest";

import { createTwitchHelixReader } from "../adapters/twitch/twitch-helix-reader";
import { createKickOfficialReader } from "../adapters/kick/kick-official-reader";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

describe("provider search pages", () => {
  it("finds broad Twitch channel matches and advances with the target cursor", async () => {
    const requests: {
      query: string;
      variables: { query: string; cursor?: string };
    }[] = [];
    const twitch = createTwitchHelixReader({
      clientId: null,
      readAccessToken: async () => null,
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          query: string;
          variables: { query: string; cursor?: string };
        };
        requests.push(body);
        if (body.query.includes("user(login:")) {
          return json({
            data: {
              user: {
                id: "1",
                login: "henny",
                displayName: "henny",
                stream: null,
              },
            },
          });
        }
        const second = body.variables.cursor === "MTU=";
        return json({
          data: {
            searchFor: {
              channels: {
                cursor: second ? null : "MTU=",
                edges: second
                  ? [
                      {
                        item: {
                          id: "3",
                          login: "henny_tvrs",
                          displayName: "HENNY_TVRS",
                          stream: null,
                        },
                      },
                    ]
                  : [
                      {
                        item: {
                          id: "1",
                          login: "henny",
                          displayName: "henny",
                          stream: null,
                        },
                      },
                      {
                        item: {
                          id: "2",
                          login: "hennygm",
                          displayName: "hennygm",
                          stream: null,
                        },
                      },
                    ],
              },
            },
          },
        });
      },
    });

    const first = await twitch.searchPage({ kind: "channels", query: "henny" });
    const second = await twitch.searchPage({
      kind: "channels",
      query: "henny",
      cursor: first.cursor,
    });

    expect(first.items.map((channel) => channel.username)).toEqual([
      "henny",
      "hennygm",
    ]);
    expect(first.cursor).toBe("MTU=");
    expect(second.items.map((channel) => channel.username)).toEqual([
      "henny_tvrs",
    ]);
    expect(
      requests.filter((body) => body.query.includes("user(login:")),
    ).toHaveLength(1);
    expect(requests.at(-1)?.query).toMatch(
      /index:\s*CHANNEL,\s*cursor:\s*\$cursor/,
    );
    expect(requests.at(-1)?.query).toMatch(/\$cursor:\s*String\b/);
    expect(requests.at(-1)?.variables.cursor).toBe("MTU=");
  });

  it("includes partial Kick channels while keeping an offline result offline", async () => {
    const kick = createKickOfficialReader({
      readAccessToken: async () => null,
      fetch: async (url) => {
        if (String(url).includes("api/search?searched_word=")) {
          return json({
            channels: [
              {
                id: 10,
                slug: "hennytingzz",
                isLive: false,
                user: {
                  username: "Hennytingzz",
                  profilePic: "https://example.com/a.png",
                },
              },
              {
                id: 11,
                slug: "thatgirlhenny",
                isLive: true,
                user: { username: "ThatGirlHenny" },
              },
            ],
            categories: [],
          });
        }
        return json({});
      },
    });

    const page = await kick.searchPage({ kind: "channels", query: "henny" });

    expect(
      page.items.map((channel) => [channel.username, channel.isLive]),
    ).toEqual([
      ["hennytingzz", false],
      ["thatgirlhenny", true],
    ]);
  });
});
