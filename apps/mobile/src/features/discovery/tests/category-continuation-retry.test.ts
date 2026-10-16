// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it } from "vitest";

import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type { DiscoverySession } from "../capabilities/platform-reads";
import { useCategoryDetail } from "../components/use-category-detail";
import { fixtureStream } from "../domain/discovery-fixture";

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

it("keeps a failed continuation available for explicit retry without refreshing the first page", async () => {
  const reads: string[] = [];
  let continuationAttempts = 0;
  const session: DiscoverySession = {
    readTopStreams: unexpected,
    readCategories: unexpected,
    searchCategories: unexpected,
    searchPage: unexpected,
    readCategory: unexpected,
    readCategoryClips: unexpected,
    readCategoryVideos: unexpected,
    readChannel: unexpected,
    readChannelVideos: unexpected,
    readChannelClips: unexpected,
    readCategoryStreams: async ({ platform, cursor }) => {
      reads.push(`${platform}:${cursor ?? "first"}`);
      if (platform === "twitch" && cursor) {
        continuationAttempts += 1;
        return continuationAttempts === 1
          ? {
              cache: { kind: "miss" },
              error: { code: "twitch-failed", retry: "manual" },
              items: [],
              path: { kind: "guest", platform },
              platform,
              status: "failed",
            }
          : {
              cache: { kind: "miss" },
              items: [fixtureStream(platform, "second", 10)],
              path: { kind: "guest", platform },
              platform,
              status: "complete",
            };
      }
      return {
        cache: { kind: "miss" },
        items: [fixtureStream(platform, "first", 10)],
        path: { kind: "guest", platform },
        platform,
        status: "complete",
        ...(platform === "twitch" ? { cursor: "next" } : {}),
      };
    },
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(document.createElement("div"));
  const category = {
    boxArtUrl: "",
    id: "509658",
    name: "Just Chatting",
    otherId: "15",
    platform: "twitch" as const,
  };
  let detail: ReturnType<typeof useCategoryDetail> | undefined;
  function Probe() {
    detail = useCategoryDetail({ category, preferences, session });
    return null;
  }
  try {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(Probe),
        ),
      );
    });
    expect(reads).toEqual(["twitch:first", "kick:first"]);
    await act(async () => detail?.loadMore("twitch"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(reads).toEqual(["twitch:first", "kick:first", "twitch:next"]);
    expect(detail?.pageErrors.twitch).toBe("twitch-failed");
    expect(
      detail?.view.media.kind === "live"
        ? detail.view.media.items.map((item) => item.id)
        : [],
    ).toEqual(["first", "first"]);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5_100));
    });
    expect(reads).toEqual(["twitch:first", "kick:first", "twitch:next"]);
    expect(detail?.pageErrors.twitch).toBe("twitch-failed");

    await act(async () => detail?.retryPage("twitch"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(reads).toEqual([
      "twitch:first",
      "kick:first",
      "twitch:next",
      "twitch:next",
    ]);
    expect(detail?.pageErrors.twitch).toBeUndefined();
    expect(
      detail?.view.media.kind === "live"
        ? detail.view.media.items.map((item) => item.id)
        : [],
    ).toEqual(["first", "second", "first"]);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
}, 12_000);
