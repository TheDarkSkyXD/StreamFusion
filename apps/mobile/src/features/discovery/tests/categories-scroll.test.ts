// @vitest-environment jsdom
import { act, createElement, useImperativeHandle, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FlatListProps } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type { DiscoverySession } from "../capabilities/platform-reads";
import { CategoriesView } from "../components/categories-screen";
import { useCategoryCatalog } from "../components/use-category-catalog";
import { composeCategoryCatalog } from "../domain/category-catalog";
import type { CatalogCategory } from "../domain/category-identity";
import { fixtureCategory, fixtureOutcome } from "../domain/discovery-fixture";

const listState = vi.hoisted(() => ({
  first: 0,
  last: 6,
  props: null as FlatListProps<CatalogCategory> | null,
  scrollOffsets: [] as number[],
}));

vi.mock("react-native", () => {
  function host(props: {
    readonly accessibilityLabel?: string;
    readonly children?: ReactNode;
    readonly onPress?: () => void;
    readonly testID?: string;
  }) {
    return createElement(
      "div",
      {
        "aria-label": props.accessibilityLabel,
        "data-testid": props.testID,
        onClick: props.onPress,
      },
      props.children,
    );
  }
  function slot(value: FlatListProps<CatalogCategory>["ListHeaderComponent"]) {
    return typeof value === "function" ? createElement(value) : value;
  }
  return {
    ActivityIndicator: host,
    FlatList(
      props: FlatListProps<CatalogCategory> & {
        readonly ref?: React.Ref<{
          scrollToOffset: (input: { offset: number }) => void;
        }>;
      },
    ) {
      listState.props = props;
      useImperativeHandle(props.ref, () => ({
        scrollToOffset: ({ offset }: { offset: number }) => {
          listState.scrollOffsets.push(offset);
        },
      }));
      return createElement(
        "div",
        { "data-testid": props.testID },
        slot(props.ListHeaderComponent),
        props.data
          ?.slice(listState.first, listState.last)
          .map((item, offset) => {
            const index = listState.first + offset;
            return createElement(
              "div",
              {
                key: props.keyExtractor?.(item, index) ?? index,
              },
              props.renderItem?.({
                item,
                index,
                separators: {
                  highlight() {},
                  unhighlight() {},
                  updateProps() {},
                },
              }),
            );
          }),
        props.data?.length === 0 ? slot(props.ListEmptyComponent) : null,
        slot(props.ListFooterComponent),
      );
    },
    Image: () => null,
    Pressable: host,
    RefreshControl: () => null,
    ScrollView: host,
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    Text: host,
    TextInput: host,
    View: host,
  };
});

vi.mock("../components/discovery-search-dock", () => ({
  DiscoverySearchDock(props: {
    readonly onChangeQuery: (query: string) => void;
    readonly query: string;
    readonly testID: string;
  }) {
    return createElement("input", {
      "data-testid": props.testID,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        props.onChangeQuery(event.target.value),
      value: props.query,
    });
  },
}));

vi.mock("@mobile/design/select", () => ({
  MobileSelect: () => createElement("select"),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

vi.mock("lucide-react-native", () => ({
  ChevronDown: () => null,
}));

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

function mountView(view: ReturnType<typeof composeCategoryCatalog>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const opened: string[] = [];
  const loaded: string[] = [];
  let platform: "all" | "twitch" | "kick" = "all";
  let query = view.query;
  let canLoadMore = true;
  let refreshing = false;
  let currentView = view;
  function render() {
    root.render(
      createElement(CategoriesView, {
        canLoadMore,
        onChangeLanguage() {},
        onChangePlatform(next) {
          platform = next;
          render();
        },
        onChangeQuery(next) {
          query = next;
          currentView = { ...currentView, query };
          render();
        },
        onOpenAccounts() {},
        onOpenCategory(category) {
          opened.push(`${category.platform}:${category.id}`);
        },
        onLoadMore() {
          loaded.push(platform);
        },
        platform,
        refreshing,
        view: currentView,
      }),
    );
  }
  act(render);
  return {
    container,
    opened,
    loaded,
    render,
    setCanLoadMore(next: boolean) {
      canLoadMore = next;
      act(render);
    },
    setRefreshing(next: boolean) {
      refreshing = next;
      act(render);
    },
    setQuery(next: string) {
      query = next;
      currentView = { ...currentView, query };
      act(render);
    },
    dispose() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  listState.first = 0;
  listState.last = 6;
  listState.props = null;
  listState.scrollOffsets.length = 0;
});

describe("category scrolling", () => {
  it("passes 101 categories to the two-column grid and opens the odd tail", () => {
    const categories = Array.from({ length: 101 }, (_, index) =>
      fixtureCategory("twitch", String(index), `Game ${index}`, 200 - index),
    );
    const screen = mountView(
      composeCategoryCatalog({
        twitch: { ...fixtureOutcome("twitch", "ready"), items: categories },
        kick: { ...fixtureOutcome("kick", "ready"), items: [] },
        language: "all",
        loading: false,
        query: "",
      }),
    );
    try {
      expect(listState.props?.data).toHaveLength(101);
      expect(listState.props?.numColumns).toBe(2);
      expect(
        screen.container.querySelectorAll('[data-testid^="category-card-"]'),
      ).toHaveLength(6);
      listState.first = 100;
      listState.last = 101;
      act(screen.render);
      expect(
        screen.container.querySelector(
          '[data-testid="category-card-twitch-100"]',
        ),
      ).not.toBeNull();
      expect(
        screen.container.querySelectorAll('[data-testid^="category-card-"]'),
      ).toHaveLength(1);
      act(() => {
        screen.container
          .querySelector<HTMLElement>(
            '[data-testid="category-card-twitch-100"]',
          )
          ?.click();
      });
      expect(screen.opened).toEqual(["twitch:100"]);
      act(() => listState.props?.onEndReached?.({ distanceFromEnd: 0 }));
      expect(screen.loaded).toEqual(["all"]);
      screen.setCanLoadMore(false);
      act(() => listState.props?.onEndReached?.({ distanceFromEnd: 0 }));
      expect(screen.loaded).toEqual(["all"]);
      screen.setCanLoadMore(true);
      screen.setRefreshing(true);
      act(() => listState.props?.onEndReached?.({ distanceFromEnd: 0 }));
      expect(screen.loaded).toEqual(["all", "all"]);
    } finally {
      screen.dispose();
    }
  });

  it("uses the selected provider identity and resets scroll without replacing search input", () => {
    const screen = mountView(
      composeCategoryCatalog({
        twitch: {
          ...fixtureOutcome("twitch", "ready"),
          items: [fixtureCategory("twitch", "509658", "Just Chatting", 30)],
        },
        kick: {
          ...fixtureOutcome("kick", "ready"),
          items: [fixtureCategory("kick", "15", "Just Chatting", 10)],
        },
        language: "all",
        loading: false,
        query: "",
      }),
    );
    try {
      const input = screen.container.querySelector(
        '[data-testid="categories-search"]',
      );
      expect(input).not.toBeNull();
      if (!(input instanceof HTMLInputElement))
        throw new Error("Search input missing");
      input.focus();
      act(() => {
        screen.container
          .querySelector<HTMLElement>(
            '[data-testid="categories-platform-kick"]',
          )
          ?.click();
      });
      expect(
        screen.container.querySelector('[data-testid="categories-search"]'),
      ).toBe(input);
      expect(document.activeElement).toBe(input);
      const projected = listState.props?.data;
      screen.setRefreshing(true);
      expect(listState.props?.data).toBe(projected);
      act(() => {
        screen.container
          .querySelector<HTMLElement>('[data-testid="category-card-kick-15"]')
          ?.click();
      });
      expect(screen.opened).toEqual(["kick:15"]);
      screen.setQuery("Just");
      expect(
        screen.container.querySelector('[data-testid="categories-search"]'),
      ).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(listState.scrollOffsets).toEqual([0, 0, 0]);
    } finally {
      screen.dispose();
    }
  });

  it("keeps loading skeletons and retained cards during refresh", () => {
    const loading = mountView(
      composeCategoryCatalog({
        language: "all",
        loading: true,
        query: "",
      }),
    );
    expect(
      loading.container.querySelectorAll('[aria-label="Loading content"]'),
    ).toHaveLength(3);
    loading.dispose();
    const retained = mountView(
      composeCategoryCatalog({
        twitch: { ...fixtureOutcome("twitch", "twitch-fail"), items: [] },
        kick: {
          ...fixtureOutcome("kick", "ready"),
          items: [fixtureCategory("kick", "15", "Just Chatting", 10)],
        },
        language: "all",
        loading: false,
        query: "",
      }),
    );
    try {
      retained.setRefreshing(true);
      expect(
        retained.container.querySelector(
          '[data-testid="category-card-kick-15"]',
        ),
      ).not.toBeNull();
      expect(
        retained.container.querySelector('[aria-label="Loading categories"]'),
      ).not.toBeNull();
    } finally {
      retained.dispose();
    }
  });

  it("advances each eligible provider once while the other provider is pending", async () => {
    let releaseTwitch:
      ((value: ReturnType<typeof fixtureOutcome>) => void) | undefined;
    const twitchSecond = new Promise<ReturnType<typeof fixtureOutcome>>(
      (resolve) => {
        releaseTwitch = resolve;
      },
    );
    const reads: string[] = [];
    const session = sessionWith({
      readCategories: async ({ platform, cursor }) => {
        reads.push(`${platform}:${cursor ?? "first"}`);
        if (platform === "twitch" && cursor === "next") return twitchSecond;
        return {
          ...fixtureOutcome(platform, "ready"),
          cursor: cursor === undefined ? "next" : undefined,
          items: [
            fixtureCategory(
              platform,
              cursor === undefined ? "first" : "second",
              `${platform} ${cursor === undefined ? "first" : "second"}`,
              10,
            ),
          ],
        };
      },
      searchCategories: async ({ platform }) =>
        fixtureOutcome(platform, "ready"),
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    let catalog: ReturnType<typeof useCategoryCatalog> | undefined;
    function Probe() {
      catalog = useCategoryCatalog({ preferences, query: "", session });
      return createElement(
        "span",
        null,
        catalog.view.categories.map((item) => item.id).join(","),
      );
    }
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client }, createElement(Probe)),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    try {
      expect(container.textContent).toBe("first,first");
      const before = catalog?.view;
      await act(async () => {
        catalog?.loadMore("twitch");
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(catalog?.view).toBe(before);
      await act(async () => {
        catalog?.loadMore("all");
        catalog?.loadMore("all");
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(reads.filter((read) => read === "twitch:next")).toHaveLength(1);
      expect(reads.filter((read) => read === "kick:next")).toHaveLength(1);
      expect(catalog?.view.categories.map((item) => item.id)).toContain(
        "second",
      );
      expect(catalog?.canLoadMore.kick).toBe(false);
      expect(catalog?.canLoadMore.twitch).toBe(false);
      await act(async () => {
        releaseTwitch?.({
          ...fixtureOutcome("twitch", "ready"),
          items: [fixtureCategory("twitch", "second", "twitch second", 10)],
        });
        await twitchSecond;
      });
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(
          catalog?.view.providers.twitch.items.map((item) => item.id),
        ).toEqual(["first", "second"]);
      });
      expect(reads).toEqual([
        "twitch:first",
        "kick:first",
        "twitch:next",
        "kick:next",
      ]);
      expect(catalog?.view.providers.kick.items.map((item) => item.id)).toEqual(
        ["first", "second"],
      );
    } finally {
      await act(async () => root.unmount());
      client.clear();
    }
  });
});
