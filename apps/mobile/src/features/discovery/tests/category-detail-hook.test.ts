// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type { DiscoverySession } from "../capabilities/platform-reads";
import {
  shouldRetryCategoryRead,
  useCategoryDetail,
} from "../components/use-category-detail";
import { fixtureOutcome } from "../domain/discovery-fixture";

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
