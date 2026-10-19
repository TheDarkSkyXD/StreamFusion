import { createRelaySuccessEnvelope } from "@streamfusion/core/relay";
import { describe, expect, it } from "vitest";

import { createRelaySignedOutReader } from "../adapters/relay/relay-signed-out-reader";
import { createTwitchHelixReader } from "../adapters/twitch/twitch-helix-reader";
import {
  collapseCategoryPages,
  mergeCategories,
  nextCategoryCursor,
} from "../domain/category-catalog";
import {
  fixtureCategory,
  fixtureClip,
  fixtureOutcome,
  fixtureVideo,
} from "../domain/discovery-fixture";

describe("category catalog pagination", () => {
  it.each(["clips", "videos"] as const)(
    "forwards signed-out %s cursors through Relay",
    async (kind) => {
      const urls: string[] = [];
      const reader = createRelaySignedOutReader({
        baseUrl: "https://relay.test/",
        fetch: async (input) => {
          const url = String(input);
          urls.push(url);
          const first = new URL(url).searchParams.get("cursor") === null;
          return new Response(
            JSON.stringify(
              createRelaySuccessEnvelope({
                body:
                  kind === "clips"
                    ? {
                        kind: "available",
                        platform: "twitch",
                        clips: [
                          fixtureClip("twitch", first ? "one" : "two", 1),
                        ],
                        ...(first ? { cursor: "next-page" } : {}),
                      }
                    : {
                        kind: "available",
                        platform: "twitch",
                        videos: [
                          fixtureVideo("twitch", first ? "one" : "two", 1),
                        ],
                        ...(first ? { cursor: "next-page" } : {}),
                      },
                requestId: "req_category_media_page",
              }),
            ),
            { status: 200 },
          );
        },
        installation: async () => ({ credential: "install", kind: "ready" }),
      });
      const first =
        kind === "clips"
          ? await reader.getCategoryClips({
              platform: "twitch",
              categoryId: "509658",
              timeRange: "all",
            })
          : await reader.getCategoryVideos({
              platform: "twitch",
              categoryId: "509658",
              sort: "recent",
            });
      if (!("items" in first)) throw new Error("Expected Twitch media page");
      const second =
        kind === "clips"
          ? await reader.getCategoryClips({
              platform: "twitch",
              categoryId: "509658",
              timeRange: "all",
              cursor: first.cursor,
            })
          : await reader.getCategoryVideos({
              platform: "twitch",
              categoryId: "509658",
              sort: "recent",
              cursor: first.cursor,
            });
      if (!("items" in second)) throw new Error("Expected Twitch media page");
      expect(first.items.map((item) => item.id)).toEqual(["one"]);
      expect(first.cursor).toBe("next-page");
      expect(second.items.map((item) => item.id)).toEqual(["two"]);
      expect(second.cursor).toBeUndefined();
      expect(new URL(urls[1] ?? "").searchParams.get("cursor")).toBe(
        "next-page",
      );
    },
  );
  it("requests 60 Helix games and forwards the opaque continuation cursor", async () => {
    const urls: string[] = [];
    const reader = createTwitchHelixReader({
      clientId: "client",
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "g1",
                name: "Game",
                box_art_url: "https://example.com/box.jpg",
              },
            ],
            pagination: { cursor: "next-page" },
          }),
          { status: 200 },
        );
      },
      readAccessToken: async () => "token",
    });

    const first = await reader.getCategories();
    await reader.getCategories({ cursor: first.cursor });

    expect(first.cursor).toBe("next-page");
    expect(first.items.map((item) => item.id)).toEqual(["g1"]);
    expect(new URL(urls[0] ?? "").searchParams.get("first")).toBe("60");
    expect(new URL(urls[1] ?? "").searchParams.get("after")).toBe("next-page");
  });

  it("forwards the Relay cursor and retains its next cursor", async () => {
    const urls: string[] = [];
    const reader = createRelaySignedOutReader({
      baseUrl: "https://relay.test/",
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify(
            createRelaySuccessEnvelope({
              body: {
                categories: [fixtureCategory("twitch", "g1", "Game", 1)],
                cursor: "relay-next",
                platform: "twitch",
              },
              requestId: "req_category_page_1",
            }),
          ),
          { status: 200 },
        );
      },
      installation: async () => ({ credential: "install", kind: "ready" }),
    });

    const first = await reader.getCategories({ platform: "twitch" });
    await reader.getCategories({ platform: "twitch", cursor: first.cursor });

    expect(first.cursor).toBe("relay-next");
    expect(new URL(urls[1] ?? "").searchParams.get("cursor")).toBe(
      "relay-next",
    );
  });

  it("keeps unique provider items and stops on empty or repeated pages", () => {
    const first = {
      ...fixtureOutcome("twitch", "ready"),
      cursor: "next",
      items: [fixtureCategory("twitch", "one", "Game One", 10)],
    };
    const second = {
      ...fixtureOutcome("twitch", "ready"),
      cursor: "next",
      items: [
        fixtureCategory("twitch", "one", "Game One", 10),
        fixtureCategory("twitch", "two", "Game Two", 20),
      ],
    };

    expect(nextCategoryCursor(first, [first])).toBe("next");
    expect(nextCategoryCursor(second, [first, second])).toBeUndefined();
    expect(
      nextCategoryCursor({ ...second, items: [] }, [first, second]),
    ).toBeUndefined();
    expect(
      collapseCategoryPages([first, second]).items.map((item) => item.id),
    ).toEqual(["one", "two"]);
    expect(
      mergeCategories([...first.items, ...second.items]).map(
        (item) => item.viewerCount,
      ),
    ).toEqual([20, 10]);
  });
});
