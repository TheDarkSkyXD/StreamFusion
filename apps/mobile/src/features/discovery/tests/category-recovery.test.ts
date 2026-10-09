// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type { DiscoverySession } from "../capabilities/platform-reads";
import { useCategoryCatalog } from "../components/use-category-catalog";
import { useCategoryDetail } from "../components/use-category-detail";
import { fixtureCategory, fixtureStream } from "../domain/discovery-fixture";

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

const category = fixtureCategory("twitch", "509658", "Just Chatting", 42);

async function flushQueryUpdates() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function sessionWith(reads: Partial<DiscoverySession>): DiscoverySession {
  return {
    readTopStreams: unexpected,
    readCategories: unexpected,
    searchCategories: unexpected,
    readCategory: unexpected,
    readCategoryStreams: unexpected,
    readCategoryClips: unexpected,
    readCategoryVideos: unexpected,
    search: unexpected,
    readChannel: unexpected,
    readChannelVideos: unexpected,
    readChannelClips: unexpected,
    ...reads,
  };
}

async function mount(probe: () => ReturnType<typeof createElement>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(probe),
      ),
    );
  });
  await flushQueryUpdates();
  return {
    container,
    queryClient,
    async dispose() {
      await act(async () => root.unmount());
      queryClient.clear();
    },
  };
}

describe("category read recovery", () => {
  it("keeps saved categories visible when a catalog refresh falls back to stale cache", async () => {
    let offline = false;
    const session = sessionWith({
      readCategories: async ({ platform }) =>
        platform === "kick"
          ? {
              cache: { kind: "miss" },
              items: [],
              path: { kind: "guest", platform },
              platform,
              status: "complete",
            }
          : offline
            ? {
                cache: { ageMilliseconds: 60_000, kind: "hit", stale: true },
                error: { code: "offline", retry: "after" },
                items: [category],
                path: { kind: "unavailable", platform, reason: "offline" },
                platform,
                status: "stale",
              }
            : {
                cache: { kind: "miss" },
                items: [category],
                path: { kind: "guest", platform },
                platform,
                status: "complete",
              },
    });
    function Probe() {
      const { view } = useCategoryCatalog({ preferences, query: "", session });
      return createElement(
        "span",
        null,
        `${view.phase}:${view.categories.map((item) => item.name).join(",")}`,
      );
    }
    const screen = await mount(Probe);
    try {
      expect(screen.container.textContent).toBe("ready:Just Chatting");
      offline = true;
      await act(async () => {
        await screen.queryClient.invalidateQueries({
          queryKey: ["discovery", "categories"],
        });
      });
      await flushQueryUpdates();
      expect(screen.container.textContent).toBe("offline-cache:Just Chatting");
    } finally {
      await screen.dispose();
    }
  });

  it("retains loaded live streams through a transient refetch failure and then replaces them", async () => {
    let read = 0;
    const session = sessionWith({
      readCategoryStreams: async ({ platform }) => {
        read += 1;
        if (read === 2) {
          return {
            cache: { kind: "miss" },
            error: { code: "relay-unavailable", retry: "after" },
            items: [],
            path: {
              kind: "unavailable",
              platform,
              reason: "relay-unavailable",
            },
            platform,
            status: "failed",
          };
        }
        return {
          cache: { kind: "miss" },
          items: [
            fixtureStream(platform, read === 1 ? "first" : "replacement", 12),
          ],
          path: { kind: "guest", platform },
          platform,
          status: "complete",
        };
      },
    });
    function Probe() {
      const { recovering, view } = useCategoryDetail({
        category,
        preferences,
        session,
      });
      const ids =
        view.media.kind === "live"
          ? view.media.items.map((item) => item.id).join(",")
          : "";
      return createElement("span", null, `${view.phase}:${ids}:${recovering}`);
    }
    const screen = await mount(Probe);
    try {
      expect(screen.container.textContent).toBe("ready:first:false");
      await act(async () => {
        await screen.queryClient.invalidateQueries({
          queryKey: ["discovery", "category-media"],
        });
      });
      await flushQueryUpdates();
      expect(screen.container.textContent).toBe("ready:first:true");
      await act(async () => {
        await screen.queryClient.invalidateQueries({
          queryKey: ["discovery", "category-media"],
        });
      });
      await flushQueryUpdates();
      expect(screen.container.textContent).toBe("ready:replacement:false");
    } finally {
      await screen.dispose();
    }
  });

  it("does not show a loading state or start reads for disabled providers", async () => {
    const session = sessionWith({});
    function Probe() {
      const catalog = useCategoryCatalog({
        enabled: false,
        preferences,
        query: "",
        session,
      });
      const detail = useCategoryDetail({
        category,
        enabled: false,
        preferences,
        session,
      });
      return createElement(
        "span",
        null,
        `${catalog.view.phase}:${detail.view.phase}:${detail.recovering}`,
      );
    }
    const screen = await mount(Probe);
    try {
      expect(screen.container.textContent).toBe("failed:failed:false");
    } finally {
      await screen.dispose();
    }
  });
});
