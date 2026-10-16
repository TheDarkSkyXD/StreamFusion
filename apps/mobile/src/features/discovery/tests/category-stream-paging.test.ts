// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type {
  DiscoverySession,
  PlatformReadOutcome,
} from "../capabilities/platform-reads";
import { useCategoryDetail } from "../components/use-category-detail";
import { fixtureStream } from "../domain/discovery-fixture";
import { createKickOfficialReader } from "../adapters/kick/kick-official-reader";
import { createTwitchGqlGuestReader } from "../adapters/twitch/twitch-gql-guest";
import { nextCategoryMediaCursor } from "../domain/category-detail";
import type { Stream } from "@streamfusion/core/content";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const preferences: DiscoveryPreferenceStore = {
  readLanguage: async () => "all",
  writeLanguage: async () => undefined,
  readClipTimeRange: async () => "all",
  writeClipTimeRange: async () => undefined,
};

const category = {
  id: "509658",
  otherId: "15",
  name: "Just Chatting",
  platform: "twitch" as const,
  boxArtUrl: "",
};
const categoryWithoutOtherId = { ...category, otherId: undefined };

function outcome(
  platform: "twitch" | "kick",
  id: string,
  cursor?: string,
): PlatformReadOutcome<Stream> {
  return {
    cache: { kind: "miss" },
    items: [fixtureStream(platform, id, 10)],
    path: { kind: "guest", platform },
    platform,
    status: "complete",
    ...(cursor === undefined ? {} : { cursor }),
  };
}

describe("category live paging", () => {
  it("continues past an empty filtered page with a valid cursor", () => {
    const first = outcome("twitch", "t1", "one");
    const empty: PlatformReadOutcome<Stream> = {
      ...first,
      items: [],
      cursor: "two",
    };
    expect(nextCategoryMediaCursor(empty, [first, empty])).toBe("two");
    const repeated = outcome("twitch", "t1", "three");
    expect(
      nextCategoryMediaCursor(repeated, [first, repeated]),
    ).toBeUndefined();
  });

  it("advances Twitch game streams through GQL edge cursors", async () => {
    const cursors: (string | null)[] = [];
    const reader = createTwitchGqlGuestReader({
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        const cursor = request.variables.cursor as string | null;
        cursors.push(cursor);
        return new Response(
          JSON.stringify({
            data: {
              game: {
                id: "509658",
                name: "Just Chatting",
                streams: {
                  edges: [
                    {
                      cursor: cursor ? "last" : "second",
                      node: {
                        id: cursor ? "t2" : "t1",
                        title: "Chat",
                        viewersCount: 10,
                        broadcaster: {
                          id: "1",
                          login: "alice",
                          displayName: "Alice",
                        },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: cursor === null },
                },
              },
            },
          }),
          { status: 200 },
        );
      },
    });
    const first = await reader.getCategoryStreams({ categoryId: "509658" });
    const second = await reader.getCategoryStreams({
      categoryId: "509658",
      cursor: first.cursor,
    });
    expect(first.items.map((item) => item.id)).toEqual(["t1"]);
    expect(first.cursor).toBe("second");
    expect(second.items.map((item) => item.id)).toEqual(["t2"]);
    expect(second.cursor).toBeUndefined();
    expect(cursors).toEqual([null, "second"]);
  });

  it("resolves an absent other-provider ID from a verified category search", async () => {
    const reads: string[] = [];
    let lookupFailed = true;
    const unexpected = async (): Promise<never> => {
      throw new Error("Unexpected read");
    };
    const session: DiscoverySession = {
      readTopStreams: unexpected,
      readCategories: unexpected,
      searchCategories: unexpected,
      searchPage: async ({ platform, query, cursor }) => {
        reads.push(`lookup:${platform}:${query}:${cursor ?? "first"}`);
        if (lookupFailed) {
          return {
            cache: { kind: "miss" },
            error: { code: "kick-failed", retry: "manual" },
            items: [],
            path: { kind: "guest", platform },
            platform,
            resultKind: "categories",
            status: "failed",
          };
        }
        return {
          cache: { kind: "miss" },
          items:
            cursor === undefined
              ? []
              : [
                  {
                    id: "15",
                    name: "Just Chatting",
                    boxArtUrl: "",
                    platform: "kick",
                  },
                ],
          path: { kind: "guest", platform },
          platform,
          resultKind: "categories",
          status: "complete",
          ...(cursor === undefined ? { cursor: "next" } : {}),
        };
      },
      readCategory: unexpected,
      readCategoryStreams: async ({ platform, categoryId }) => {
        reads.push(`streams:${platform}:${categoryId}`);
        return outcome(platform, platform === "twitch" ? "t1" : "k1");
      },
      readCategoryClips: unexpected,
      readCategoryVideos: unexpected,
      readChannel: unexpected,
      readChannelVideos: unexpected,
      readChannelClips: unexpected,
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const root = createRoot(document.createElement("div"));
    let detail: ReturnType<typeof useCategoryDetail> | undefined;
    function Probe() {
      detail = useCategoryDetail({
        category: categoryWithoutOtherId,
        preferences,
        session,
      });
      return createElement("span", null, detail.view.phase);
    }
    try {
      await act(async () =>
        root.render(
          createElement(QueryClientProvider, { client }, createElement(Probe)),
        ),
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(detail?.categoryMatch).toBe("failed");
      expect(reads).not.toContain("streams:kick:15");
      lookupFailed = false;
      await act(async () => detail?.retryCategoryMatch());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(detail?.categoryMatch).toBe("found");
      expect(reads).toContain("lookup:kick:Just Chatting:first");
      expect(reads).toContain("lookup:kick:Just Chatting:next");
      expect(reads).toContain("streams:kick:15");
      expect(
        detail?.view.media.kind === "live"
          ? detail.view.media.items.map((item) => item.id)
          : [],
      ).toEqual(["t1", "k1"]);
    } finally {
      await act(async () => root.unmount());
      client.clear();
    }
  });

  it("loads each provider independently and retains prior pages when a next page fails", async () => {
    const calls: string[] = [];
    const failed: PlatformReadOutcome<Stream> = {
      cache: { kind: "miss" },
      error: { code: "twitch-failed", retry: "manual" },
      items: [],
      path: { kind: "guest", platform: "twitch" },
      platform: "twitch",
      status: "failed",
    };
    const unexpected = async (): Promise<never> => {
      throw new Error("Unexpected read");
    };
    const session: DiscoverySession = {
      readTopStreams: unexpected,
      readCategories: unexpected,
      searchCategories: unexpected,
      searchPage: unexpected,
      readCategory: unexpected,
      readCategoryStreams: async ({ platform, cursor }) => {
        calls.push(`${platform}:${cursor ?? "first"}`);
        if (platform === "twitch")
          return cursor ? failed : outcome(platform, "t1", "t-next");
        return cursor
          ? outcome(platform, "k2")
          : outcome(platform, "k1", "k-next");
      },
      readCategoryClips: unexpected,
      readCategoryVideos: unexpected,
      readChannel: unexpected,
      readChannelVideos: unexpected,
      readChannelClips: unexpected,
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    let detail: ReturnType<typeof useCategoryDetail> | undefined;
    function Probe() {
      detail = useCategoryDetail({ category, preferences, session });
      const ids =
        detail.view.media.kind === "live"
          ? detail.view.media.items.map((item) => item.id).join(",")
          : "";
      return createElement("span", null, ids);
    }
    try {
      await act(async () =>
        root.render(
          createElement(QueryClientProvider, { client }, createElement(Probe)),
        ),
      );
      expect(calls).toEqual(["twitch:first", "kick:first"]);
      expect(detail?.canLoadMore).toEqual({ twitch: true, kick: true });
      await act(async () => detail?.loadMore("all"));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(calls).toEqual([
        "twitch:first",
        "kick:first",
        "twitch:t-next",
        "kick:k-next",
      ]);
      expect(container.textContent).toContain("t1");
      expect(container.textContent).toContain("k1");
      expect(container.textContent).toContain("k2");
      expect(detail?.view.providers.twitch.status).toBe("complete");
      expect(detail?.view.providers.kick.status).toBe("complete");
      expect(detail?.pageErrors.twitch).toBe("twitch-failed");
      expect(detail?.pageErrors.kick).toBeUndefined();
      expect(detail?.canLoadMore).toEqual({ twitch: false, kick: false });
    } finally {
      await act(async () => root.unmount());
      client.clear();
    }
  });

  it("uses Kick's category endpoint and advances its real cursor", async () => {
    const urls: string[] = [];
    const reader = createKickOfficialReader({
      readAccessToken: async () => null,
      fetch: async (input) => {
        urls.push(String(input));
        const second = new URL(String(input)).searchParams.has("after");
        return new Response(
          JSON.stringify({
            data: {
              livestreams: [
                {
                  id: second ? "stream-two" : "stream-one",
                  title: "Chat",
                  viewer_count: 10,
                  thumbnail: { src: "https://example.com/thumbnail.webp" },
                  channel: {
                    id: 7,
                    slug: "alice",
                    username: "Alice",
                    profile_pic: "https://example.com/avatar.webp",
                  },
                  category: { id: 15, name: "Just Chatting" },
                  language: "en",
                  tags: [],
                },
              ],
              pagination: second ? {} : { next_cursor: "next-kick" },
            },
          }),
          { status: 200 },
        );
      },
    });
    const first = await reader.getCategoryStreams({ categoryId: "15" });
    const second = await reader.getCategoryStreams({
      categoryId: "15",
      cursor: first.cursor,
    });
    expect(first.items.map((item) => item.id)).toEqual(["stream-one"]);
    expect(first.cursor).toBe("next-kick");
    expect(second.items.map((item) => item.id)).toEqual(["stream-two"]);
    expect(new URL(urls[0] ?? "").searchParams.get("category_id")).toBe("15");
    expect(new URL(urls[1] ?? "").searchParams.get("after")).toBe("next-kick");
    expect(second.cursor).toBeUndefined();
  });
});
