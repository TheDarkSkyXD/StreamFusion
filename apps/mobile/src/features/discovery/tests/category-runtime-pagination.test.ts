import { describe, expect, it } from "vitest";
import type { DisposableCache } from "@mobile/features/storage/capabilities/persistence";
import { createDiscoveryRuntime } from "../composition/discovery-runtime";
import { createKickOfficialReader } from "../adapters/kick/kick-official-reader";
import { createTwitchGqlGuestReader } from "../adapters/twitch/twitch-gql-guest";

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}

describe("category runtime pagination", () => {
  it("advances guest Twitch pages and surfaces GraphQL failures", async () => {
    const requests: { variables: { cursor: string | null } }[] = [];
    const reader = createTwitchGqlGuestReader({
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        requests.push(request);
        if (request.variables.cursor === "broken")
          return json({ errors: [{ message: "Unavailable" }] });
        const first = request.variables.cursor === null;
        return json({
          data: {
            games: {
              edges: [
                {
                  cursor: "page-two",
                  node: {
                    id: first ? "one" : "two",
                    name: first ? "First Game" : "Second Game",
                    boxArtURL: "https://example.com/art.jpg",
                  },
                },
              ],
              pageInfo: { hasNextPage: first },
            },
          },
        });
      },
    });
    const first = await reader.getCategories();
    const second = await reader.getCategories({ cursor: first.cursor });
    expect(first.items.map((item) => item.name)).toEqual(["First Game"]);
    expect(second.items.map((item) => item.name)).toEqual(["Second Game"]);
    expect(requests[1]?.variables.cursor).toBe("page-two");
    expect(second.cursor).toBeUndefined();
    expect((await reader.getCategories({ cursor: "broken" })).status).toBe(
      "failed",
    );
  });

  it("advances Kick public pages and stops at the final page", async () => {
    const urls: string[] = [];
    const reader = createKickOfficialReader({
      readAccessToken: async () => null,
      fetch: async (input) => {
        const url = String(input);
        urls.push(url);
        const page = new URL(url).searchParams.get("page") === "2" ? 2 : 1;
        return json({
          current_page: page,
          last_page: 2,
          data: [
            {
              id: page,
              name: `Game ${page}`,
              banner: "https://example.com/art.jpg",
            },
          ],
        });
      },
    });
    const first = await reader.getCategories();
    const second = await reader.getCategories({ cursor: first.cursor });
    expect(first.items.map((item) => item.name)).toEqual(["Game 1"]);
    expect(second.items.map((item) => item.name)).toEqual(["Game 2"]);
    expect(new URL(urls[1] ?? "").searchParams.get("page")).toBe("2");
    expect(second.cursor).toBeUndefined();
  });

  it("preserves the cached first page when later pages load or fail", async () => {
    const rows = new Map<string, string>();
    const cache: DisposableCache = {
      clear: async () => {
        rows.clear();
      },
      get: async (key) => {
        const payload = rows.get(key);
        return payload === undefined
          ? { kind: "miss" }
          : { kind: "hit", payload, ageMilliseconds: 0, stale: false };
      },
      put: async (input) => {
        rows.set(input.key, input.payload);
      },
    };
    let offline = false;
    const session = createDiscoveryRuntime({
      cache,
      installation: { read: async () => ({ kind: "none" }) },
      kickAccessToken: async () => null,
      network: { read: async () => (offline ? "offline" : "online") },
      relayBaseUrl: "https://relay.test/",
      twitchClientId: "client",
      userTokens: {
        read: async () => ({ kind: "ready", accessToken: "test" }),
      },
      fetch: async (input) => {
        const page = new URL(String(input)).searchParams.get("after");
        return json({
          data: [
            {
              id: page === null ? "one" : "two",
              name: page === null ? "First Game" : "Second Game",
              box_art_url: "https://example.com/art.jpg",
            },
          ],
          pagination: page === null ? { cursor: "next" } : {},
        });
      },
    });
    const first = await session.readCategories({ platform: "twitch" });
    const second = await session.readCategories({
      platform: "twitch",
      cursor: first.cursor,
    });
    expect(second.items.map((item) => item.id)).toEqual(["two"]);
    offline = true;
    const saved = await session.readCategories({ platform: "twitch" });
    expect(saved.items.map((item) => item.id)).toEqual(["one"]);
    expect(saved.status).toBe("stale");
    const failed = await session.readCategories({
      platform: "twitch",
      cursor: "next",
    });
    expect(failed.status).toBe("failed");
    expect(failed.items).toEqual([]);
  });
});
