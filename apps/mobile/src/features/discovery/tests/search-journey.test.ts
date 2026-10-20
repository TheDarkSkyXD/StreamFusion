// @vitest-environment jsdom
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Category } from "@streamfusion/core/content";

import type {
  MobileSearchKind,
  SearchPageOutcome,
  SearchHistoryByScope,
  SearchHistoryRepository,
} from "../capabilities/platform-reads";
import {
  UnifiedSearchScreen,
  type SearchPresentationState,
} from "../components/unified-search-screen";
import { useUnifiedSearch } from "../components/use-unified-search";
import {
  fixtureChannel,
  fixtureCategory,
  fixtureClip,
  fixtureSearchOutcome,
  fixtureVideo,
} from "../domain/search-fixture";
import { emptySearchHistory } from "../domain/search-history";

type InputProps = {
  readonly onChangeText: (text: string) => void;
  readonly onSubmitEditing: (event: { nativeEvent: { text: string } }) => void;
  readonly testID: string;
  readonly value: string;
};

const inputState = vi.hoisted(() => ({ props: null as InputProps | null }));

vi.mock("react-native", () => {
  function host(props: {
    readonly accessibilityLabel?: string;
    readonly accessibilityState?: { readonly selected?: boolean };
    readonly children?: ReactNode;
    readonly onPress?: () => void;
    readonly testID?: string;
  }) {
    return createElement(
      "div",
      {
        "aria-label": props.accessibilityLabel,
        "data-selected": props.accessibilityState?.selected,
        "data-testid": props.testID,
        onClick: props.onPress,
      },
      props.children,
    );
  }
  return {
    ActivityIndicator: host,
    Image: host,
    Keyboard: { dismiss() {} },
    KeyboardAvoidingView: host,
    Pressable: host,
    RefreshControl: () => null,
    ScrollView: host,
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    Text: host,
    TextInput(props: InputProps) {
      inputState.props = props;
      return createElement("input", {
        "data-testid": props.testID,
        readOnly: true,
        value: props.value,
      });
    },
    View: host,
  };
});

vi.mock("lucide-react-native", () => ({
  ArrowLeft: () => null,
  Clock3: () => null,
  Search: () => null,
  X: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

vi.mock("../components/search-results-view", () => ({
  SearchResultsView: (props: {
    readonly onOpenCategory?: (category: Category) => void;
  }) => {
    return props.onOpenCategory
      ? createElement(
          "button",
          {
            "data-testid": "open-search-category",
            onClick: () =>
              props.onOpenCategory?.(fixtureCategory("twitch", "509658")),
          },
          "Open category",
        )
      : null;
  },
}));

vi.mock("../components/search-provider-banner", () => ({
  SearchProviderBanner: () => null,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("search journey", () => {
  it("does not continue Kick pages after the platform filter switches to Twitch", async () => {
    const calls: string[] = [];
    const history: SearchHistoryRepository = {
      read: async () => emptySearchHistory(),
      write: async () => undefined,
    };
    const session = {
      async searchPage<K extends MobileSearchKind>(read: {
        readonly platform: "twitch" | "kick";
        readonly kind: K;
        readonly cursor?: string;
      }): Promise<SearchPageOutcome<K>> {
        calls.push(`${read.platform}:${read.kind}:${read.cursor ?? "first"}`);
        return {
          cache: { kind: "miss" },
          items:
            read.kind === "channels" && read.cursor === undefined
              ? [fixtureChannel(read.platform, `${read.platform}-broad`)]
              : [],
          path: { kind: "guest", platform: read.platform },
          platform: read.platform,
          resultKind: read.kind,
          status: "complete",
          ...(read.cursor === undefined
            ? { cursor: `${read.platform}-next` }
            : {}),
        } as SearchPageOutcome<K>;
      },
      async searchMedia({ platform }: { platform: "twitch" | "kick" }) {
        return {
          cache: { kind: "miss" as const },
          clips:
            platform === "twitch" ? [fixtureClip("twitch", "relay-clip")] : [],
          path: { kind: "guest" as const, platform },
          platform,
          status: "complete" as const,
          videos:
            platform === "twitch"
              ? [fixtureVideo("twitch", "relay-video")]
              : [],
        };
      },
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    let latest: ReturnType<typeof useUnifiedSearch> | null = null;
    function Search({ platform }: { platform: "all" | "twitch" }) {
      latest = useUnifiedSearch({
        history,
        liveOnly: false,
        platform,
        query: "henny",
        resultType: "all",
        session,
      });
      return null;
    }
    try {
      await act(async () =>
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(Search, { platform: "all" }),
          ),
        ),
      );
      expect(calls).toContain("kick:channels:first");
      expect(
        latest?.view.collection.channels.map((channel) => channel.id),
      ).toEqual(["twitch-broad", "kick-broad"]);
      expect(latest?.view.collection.videos.map((video) => video.id)).toEqual([
        "relay-video",
      ]);
      expect(latest?.view.collection.clips.map((clip) => clip.id)).toEqual([
        "relay-clip",
      ]);
      await act(async () =>
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(Search, { platform: "twitch" }),
          ),
        ),
      );
      await act(async () => latest?.loadMore("channels"));
      expect(calls).toContain("twitch:channels:twitch-next");
      expect(calls).not.toContain("kick:channels:kick-next");
    } finally {
      await act(async () => root.unmount());
      client.clear();
    }
  });

  it("returns from browse and preview to the same tab with independent saved queries", async () => {
    let stored: SearchHistoryByScope = emptySearchHistory();
    const history: SearchHistoryRepository = {
      async read() {
        return stored;
      },
      async write(next) {
        stored = next;
      },
    };
    const reads: string[] = [];
    const session = {
      async searchMedia({ platform }: { platform: "twitch" | "kick" }) {
        return {
          cache: { kind: "miss" as const },
          clips: [],
          path: { kind: "guest" as const, platform },
          platform,
          status: "complete" as const,
          videos: [],
        };
      },
      async searchPage<K extends MobileSearchKind>({
        platform,
        query,
        kind,
      }: {
        platform: "twitch" | "kick";
        query: string;
        kind: K;
      }): Promise<SearchPageOutcome<K>> {
        reads.push(`${platform}:${kind}:${query}`);
        const outcome = fixtureSearchOutcome(platform, "ready");
        return {
          cache: outcome.cache,
          items: outcome.catalog[kind],
          path: outcome.path,
          platform,
          resultKind: kind,
          status: outcome.status,
        } as SearchPageOutcome<K>;
      },
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let saved: SearchPresentationState | null = null;

    function Journey() {
      const [focused, setFocused] = useState(false);
      const [preview, setPreviewState] = useState(false);
      if (preview)
        return createElement(
          "button",
          {
            "data-testid": "category-detail",
            onClick: () => setPreviewState(false),
          },
          "Back to Search",
        );
      return createElement(UnifiedSearchScreen, {
        categoriesPanel: createElement(
          "button",
          {
            "data-testid": "categories-search-entry",
            onClick: () => setFocused(true),
          },
          "Search",
        ),
        focused,
        history,
        onOpenAccounts() {},
        onOpenCategory() {
          setPreviewState(true);
        },
        onSearchFocusChange: setFocused,
        onStateChange(state) {
          saved = state;
        },
        ...(saved === null ? {} : { restoredState: saved }),
        session,
      });
    }

    const find = (id: string) =>
      container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const click = async (id: string) => {
      await act(async () => {
        const element = find(id);
        if (!element) throw new Error(`Missing ${id}`);
        element.click();
      });
    };
    const submit = async (query: string) => {
      await act(async () => {
        inputState.props?.onChangeText(query);
      });
      await act(async () => {
        inputState.props?.onSubmitEditing({ nativeEvent: { text: query } });
      });
    };

    try {
      await act(async () => {
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(Journey),
          ),
        );
      });
      expect(find("categories-search-entry")).not.toBeNull();
      expect(find("search-field")).toBeNull();
      expect(reads).toEqual([]);

      await click("categories-search-entry");
      expect(find("search-field")).not.toBeNull();
      expect(find("search-tab-all")).not.toBeNull();
      expect(find("search-tab-categories")).not.toBeNull();
      await submit("shroud");
      expect(reads).toEqual([
        "twitch:channels:shroud",
        "twitch:streams:shroud",
        "twitch:categories:shroud",
        "kick:channels:shroud",
        "kick:streams:shroud",
        "kick:categories:shroud",
      ]);
      await click("clear-search-field");
      expect(find("repeat-search-shroud")).not.toBeNull();

      await click("search-tab-channels");
      expect(find("repeat-search-shroud")).toBeNull();
      await submit("arcade");
      await click("search-tab-categories");
      await click("open-search-category");
      expect(find("category-detail")).not.toBeNull();
      await click("category-detail");
      expect(find("search-field")?.getAttribute("value")).toBe("arcade");
      expect(find("search-tab-categories")?.getAttribute("data-selected")).toBe(
        "true",
      );
      await click("search-tab-channels");
      expect(find("search-tab-channels")?.getAttribute("data-selected")).toBe(
        "true",
      );

      await click("clear-search-field");
      expect(find("repeat-search-arcade")).not.toBeNull();
      await click("search-clear-history");
      expect(find("search-clear-confirm")).not.toBeNull();
      await click("search-tab-all");
      expect(find("search-clear-confirm")).toBeNull();
      expect(find("repeat-search-shroud")).not.toBeNull();
      await click("repeat-search-shroud");
      expect(find("search-field")?.getAttribute("value")).toBe("shroud");
      await click("clear-search-field");
      await click("remove-search-shroud");
      expect(stored.all).toEqual([]);
      expect(stored.channels).toEqual([{ label: "arcade" }]);
      await click("search-back");
      expect(find("search-field")).toBeNull();
      expect(find("categories-search-entry")).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      client.clear();
      inputState.props = null;
    }
  });
});
