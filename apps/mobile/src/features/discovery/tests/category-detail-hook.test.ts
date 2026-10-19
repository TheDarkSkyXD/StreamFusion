// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type { DiscoverySession } from "../capabilities/platform-reads";
import {
  shouldRetryCategoryRead,
  useCategoryDetail,
} from "../components/use-category-detail";
import {
  fixtureClip,
  fixtureOutcome,
  fixtureVideo,
} from "../domain/discovery-fixture";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const unexpected = async (): Promise<never> => {
  throw new Error("Unexpected discovery read");
};

const preferences: DiscoveryPreferenceStore = {
  readLanguage: async () => "all",
  writeLanguage: async () => undefined,
  readClipTimeRange: async () => "all",
  writeClipTimeRange: async () => undefined,
};

const kickCategory = {
  boxArtUrl: "https://example.com/kick.jpg",
  id: "15",
  name: "Just Chatting",
  platform: "kick" as const,
};

describe("category detail hook", () => {
  it.each(["clips", "videos"] as const)(
    "loads distinct %s pages and stops after the final page",
    async (tab) => {
      const cursors: (string | undefined)[] = [];
      const category = {
        ...kickCategory,
        id: "509658",
        platform: "twitch" as const,
        otherId: "15",
      };
      const readPage = (cursor: string | undefined) => {
        cursors.push(cursor);
        const id = cursor === undefined ? "first" : "second";
        return {
          cache: { kind: "miss" as const },
          cursor: cursor === undefined ? "next-page" : undefined,
          items: [
            tab === "clips"
              ? fixtureClip("twitch", id, 1)
              : fixtureVideo("twitch", id, 1),
          ],
          path: { kind: "guest" as const, platform: "twitch" as const },
          platform: "twitch" as const,
          status: "complete" as const,
        };
      };
      const session: DiscoverySession = {
        readCategoryStreams: async ({ platform }) =>
          fixtureOutcome(platform, "ready"),
        readCategoryClips: async ({ cursor }) => readPage(cursor),
        readCategoryVideos: async ({ cursor }) => readPage(cursor),
        readTopStreams: unexpected,
        readCategories: unexpected,
        searchCategories: unexpected,
        readCategory: unexpected,
        searchPage: unexpected,
        search: unexpected,
        readChannel: unexpected,
        readChannelVideos: unexpected,
        readChannelClips: unexpected,
      };
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const container = document.createElement("div");
      const root = createRoot(container);
      const control: { current?: ReturnType<typeof useCategoryDetail> } = {};
      function Probe() {
        control.current = useCategoryDetail({ category, preferences, session });
        return createElement(
          "span",
          null,
          `${control.current.view.media.kind}:${control.current.view.media.kind === tab ? control.current.view.media.items.map((item) => item.id).join(",") : ""}`,
        );
      }
      try {
        await act(async () =>
          root.render(
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(Probe),
            ),
          ),
        );
        await act(async () =>
          control.current?.change({ ...control.current.view.identity, tab }),
        );
        await vi.waitFor(async () => {
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          expect(container.textContent).toBe(`${tab}:first`);
        });
        expect(control.current?.canLoadMore.twitch).toBe(true);
        await act(async () => control.current?.loadMore("twitch"));
        await vi.waitFor(async () => {
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          expect(container.textContent).toBe(`${tab}:first,second`);
        });
        expect(control.current?.canLoadMore.twitch).toBe(false);
        expect(cursors).toEqual([undefined, "next-page"]);
      } finally {
        await act(async () => root.unmount());
        queryClient.clear();
      }
    },
  );

  it.each(["initial", "intermediate"] as const)(
    "continues an empty %s video page until recorded items appear",
    async (emptyPage) => {
      const cursors: (string | undefined)[] = [];
      const category = {
        ...kickCategory,
        id: "509658",
        platform: "twitch" as const,
        otherId: "15",
      };
      const session: DiscoverySession = {
        readCategoryStreams: async ({ platform }) =>
          fixtureOutcome(platform, "ready"),
        readCategoryVideos: async ({ cursor }) => {
          cursors.push(cursor);
          return {
            cache: { kind: "miss" },
            ...(cursor === undefined
              ? { cursor: "next-page" }
              : cursor === "next-page" && emptyPage === "intermediate"
                ? { cursor: "third-page" }
                : {}),
            items:
              cursor === undefined
                ? emptyPage === "initial"
                  ? []
                  : [fixtureVideo("twitch", "first", 1)]
                : cursor === "next-page" && emptyPage === "intermediate"
                  ? []
                  : [fixtureVideo("twitch", "recorded", 1)],
            path: { kind: "guest", platform: "twitch" },
            platform: "twitch",
            status: "complete",
          };
        },
        readCategoryClips: unexpected,
        readTopStreams: unexpected,
        readCategories: unexpected,
        searchCategories: unexpected,
        readCategory: unexpected,
        searchPage: unexpected,
        search: unexpected,
        readChannel: unexpected,
        readChannelVideos: unexpected,
        readChannelClips: unexpected,
      };
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const container = document.createElement("div");
      const root = createRoot(container);
      const control: { current?: ReturnType<typeof useCategoryDetail> } = {};
      function Probe() {
        control.current = useCategoryDetail({ category, preferences, session });
        return createElement(
          "span",
          null,
          control.current.view.media.kind === "videos"
            ? control.current.view.media.items.map((item) => item.id).join(",")
            : "live",
        );
      }
      try {
        await act(async () =>
          root.render(
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(Probe),
            ),
          ),
        );
        await act(async () =>
          control.current?.change({
            ...control.current.view.identity,
            tab: "videos",
          }),
        );
        if (emptyPage === "intermediate") {
          await vi.waitFor(async () => {
            await act(async () => {
              await new Promise((resolve) => setTimeout(resolve, 0));
            });
            expect(container.textContent).toBe("first");
          });
          await act(async () => control.current?.loadMore("twitch"));
        }
        await vi.waitFor(async () => {
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          expect(container.textContent).toBe(
            emptyPage === "initial" ? "recorded" : "first,recorded",
          );
        });
        expect(cursors).toEqual(
          emptyPage === "initial"
            ? [undefined, "next-page"]
            : [undefined, "next-page", "third-page"],
        );
      } finally {
        await act(async () => root.unmount());
        queryClient.clear();
      }
    },
  );
  it("finishes a Kick-only category after its active read resolves", async () => {
    const session: DiscoverySession = {
      readCategoryStreams: async ({ platform }) =>
        fixtureOutcome(platform, "ready"),
      readTopStreams: unexpected,
      readCategories: unexpected,
      searchCategories: unexpected,
      readCategory: unexpected,
      readCategoryClips: unexpected,
      readCategoryVideos: unexpected,
      search: unexpected,
      readChannel: unexpected,
      readChannelVideos: unexpected,
      readChannelClips: unexpected,
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    function Probe() {
      const { view } = useCategoryDetail({
        category: kickCategory,
        preferences,
        session,
      });
      return createElement(
        "span",
        null,
        `${view.phase}:${view.media.kind === "live" ? view.media.items.length : 0}`,
      );
    }
    try {
      await act(async () => {
        root.render(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(Probe),
          ),
        );
      });
      expect(container.textContent).toBe("ready:1");
    } finally {
      await act(async () => root.unmount());
      queryClient.clear();
    }
  });

  it("retries transient outcomes without polling offline or account failures", () => {
    expect(
      shouldRetryCategoryRead(fixtureOutcome("twitch", "relay-unavailable")),
    ).toBe(5_000);
    expect(
      shouldRetryCategoryRead(fixtureOutcome("twitch", "retry-exhausted")),
    ).toBe(5_000);
    expect(shouldRetryCategoryRead(fixtureOutcome("twitch", "auth-lost"))).toBe(
      false,
    );
    expect(shouldRetryCategoryRead(fixtureOutcome("twitch", "cancelled"))).toBe(
      false,
    );
    expect(
      shouldRetryCategoryRead(fixtureOutcome("twitch", "stale-cache")),
    ).toBe(false);
  });
});
