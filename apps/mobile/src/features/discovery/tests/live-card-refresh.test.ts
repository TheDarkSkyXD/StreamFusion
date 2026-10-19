// @vitest-environment jsdom
import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeStreamCard } from "../components/home-stream-card";
import { LiveStreamCardsProvider } from "../components/live-stream-cards-provider";
import { categoryMediaQueryKey } from "../components/use-category-detail";
import { channelQueryKey } from "../components/use-channel-detail";
import { topStreamsQueryKey } from "../components/use-home-live-discovery";
import { searchPageQueryKey } from "../components/use-unified-search";
import { isLiveCardQueryKey } from "../domain/live-card-refresh";
import { defaultCategoryRequest } from "../domain/category-identity";
import { fixtureStream } from "../domain/discovery-fixture";
import { FollowingStreamCard } from "@mobile/features/follows/components/following-stream-card";
import { followingQueryKey } from "@mobile/features/follows/components/use-following-view";
import type { Platform } from "@streamfusion/core/platform";

const appState = vi.hoisted(() => ({
  state: "active",
  listeners: new Set<(state: string) => void>(),
  imageMounts: 0,
}));

vi.mock("react-native", () => {
  function host({
    accessibilityLabel,
    children,
    numberOfLines,
    onPress,
    testID,
  }: {
    readonly accessibilityLabel?: string;
    readonly children?: ReactNode;
    readonly numberOfLines?: number;
    readonly onPress?: () => void;
    readonly testID?: string;
  }) {
    return createElement(
      onPress ? "button" : "div",
      {
        "aria-label": accessibilityLabel,
        "data-lines": numberOfLines,
        "data-testid": testID,
        onClick: onPress,
      },
      children,
    );
  }
  function Image({
    source,
    testID,
  }: {
    readonly source: { readonly uri: string; readonly cache?: string };
    readonly testID?: string;
  }) {
    useEffect(() => {
      appState.imageMounts += 1;
    }, []);
    return createElement("img", {
      "data-cache": source.cache,
      "data-testid": testID,
      src: source.uri,
    });
  }
  return {
    AppState: {
      get currentState() {
        return appState.state;
      },
      addEventListener(_event: string, listener: (state: string) => void) {
        appState.listeners.add(listener);
        return { remove: () => appState.listeners.delete(listener) };
      },
    },
    Image,
    Pressable: host,
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    Text: host,
    View: host,
  };
});

vi.mock("@mobile/design/avatar", () => ({
  MobileAvatar: ({ name }: { readonly name: string }) =>
    createElement("div", { "data-testid": "stream-avatar" }, name),
}));
vi.mock("@mobile/design/platform-badge", () => ({
  MobilePlatformBadge: () => null,
}));
vi.mock("@mobile/design/verified-badge", () => ({
  MobileVerifiedBadge: ({ platform }: { readonly platform: string }) =>
    createElement("div", { "data-testid": `verified-badge-${platform}` }),
}));
vi.mock("@mobile/design/tag", () => ({ MobileTag: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function changeAppState(state: string) {
  appState.state = state;
  act(() => appState.listeners.forEach((listener) => listener(state)));
}

function mountCards(showLargeStreamCards = false) {
  const queryClient = new QueryClient();
  const container = document.createElement("div");
  const root = createRoot(container);
  const twitch = {
    ...fixtureStream("twitch", "one", 140),
    channelAvatar: "https://example.com/avatar.jpg",
    channelDisplayName: "A very long channel name that must fit on a phone",
    isMature: true,
    tags: ["English", "IRL"],
    thumbnailUrl:
      "https://static-cdn.jtvnw.net/previews-ttv/live_user_one-640x360.jpg",
  };
  const kick = {
    ...fixtureStream("kick", "two", 80),
    channelAvatar: "https://example.com/kick-avatar.jpg",
    thumbnailUrl:
      "https://images.kick.com/live.webp?expires=100&signature=secret",
  };
  const selected: string[] = [];
  function render(large: boolean, visible = true) {
    root.render(
      createElement(
        LiveStreamCardsProvider,
        { queryClient, showLargeStreamCards: large },
        visible
          ? createElement(HomeStreamCard, {
              stream: twitch,
              onOpen: () => selected.push("twitch"),
            })
          : null,
        visible
          ? createElement(FollowingStreamCard, {
              stream: kick,
              onOpen: () => selected.push("kick"),
            })
          : null,
      ),
    );
  }
  act(() => render(showLargeStreamCards));
  return {
    container,
    selected,
    render: (large: boolean, visible = true) =>
      act(() => render(large, visible)),
    dispose() {
      act(() => root.unmount());
      queryClient.clear();
    },
  };
}

afterEach(() => {
  appState.state = "active";
  appState.listeners.clear();
  appState.imageMounts = 0;
  vi.useRealTimers();
});

describe("shared live stream cards", () => {
  it("uses the same compact default and large choice in Watch and Following", () => {
    const cards = mountCards();
    try {
      expect(
        cards.container.querySelectorAll('[data-testid="live-card-compact"]'),
      ).toHaveLength(2);
      expect(
        cards.container.querySelectorAll('[data-testid="stream-avatar"]'),
      ).toHaveLength(2);
      expect(
        cards.container.querySelectorAll(
          '[data-testid="live-card-title"][data-lines="1"]',
        ),
      ).toHaveLength(2);
      const channelName = Array.from(
        cards.container.querySelectorAll('[data-lines="1"]'),
      ).find(
        (node) =>
          node.textContent ===
          "A very long channel name that must fit on a phone",
      );
      expect(channelName).toBeDefined();
      expect(cards.container.textContent).toContain(
        "18+ · Just Chatting · English · IRL",
      );
      expect(
        cards.container
          .querySelector('[data-testid="home-stream-twitch-one"]')
          ?.textContent?.match(/English/g),
      ).toHaveLength(1);
      expect(
        cards.container.querySelectorAll(
          '[data-testid="verified-badge-twitch"]',
        ),
      ).toHaveLength(1);
      expect(
        cards.container.querySelectorAll('[data-testid="verified-badge-kick"]'),
      ).toHaveLength(0);
      expect(
        cards.container.querySelectorAll('[data-testid="stream-viewer-count"]'),
      ).toHaveLength(2);
      const watch = cards.container.querySelector(
        '[data-testid="home-stream-twitch-one"]',
      );
      if (!(watch instanceof HTMLElement))
        throw new Error("Missing Watch card");
      act(() => watch.click());
      const following = cards.container.querySelector(
        '[data-testid="following-stream-kick-two"]',
      );
      if (!(following instanceof HTMLElement)) {
        throw new Error("Missing Following card");
      }
      act(() => following.click());
      expect(cards.selected).toEqual(["twitch", "kick"]);
      cards.render(true);
      expect(
        cards.container.querySelectorAll('[data-testid="live-card-large"]'),
      ).toHaveLength(2);
      expect(
        cards.container.querySelectorAll('[data-testid="live-card-compact"]'),
      ).toHaveLength(0);
      expect(
        cards.container.querySelectorAll(
          '[data-testid="live-card-title"][data-lines="1"]',
        ),
      ).toHaveLength(2);
      expect(
        cards.container.querySelector('[data-testid="live-card-large"]')
          ?.textContent,
      ).toContain("A very long channel name that must fit on a phone");
      expect(cards.container.textContent).not.toContain("LIVE");
    } finally {
      cards.dispose();
    }
  });

  it("refreshes stable thumbnail URLs every five minutes and on foreground return", () => {
    vi.useFakeTimers();
    const cards = mountCards();
    try {
      const initialSources = Array.from(
        cards.container.querySelectorAll('[data-testid="live-card-thumbnail"]'),
        (node) => node.getAttribute("src"),
      );
      expect(initialSources).toEqual([
        "https://static-cdn.jtvnw.net/previews-ttv/live_user_one-640x360.jpg",
        "https://images.kick.com/live.webp?expires=100&signature=secret",
      ]);
      expect(appState.imageMounts).toBe(2);
      cards.render(false);
      expect(appState.imageMounts).toBe(2);
      act(() => vi.advanceTimersByTime(300_000));
      expect(appState.imageMounts).toBe(4);
      changeAppState("background");
      act(() => vi.advanceTimersByTime(600_000));
      expect(appState.imageMounts).toBe(4);
      changeAppState("active");
      expect(appState.imageMounts).toBe(6);
      const refreshedSources = Array.from(
        cards.container.querySelectorAll('[data-testid="live-card-thumbnail"]'),
        (node) => node.getAttribute("src"),
      );
      expect(refreshedSources).toEqual(initialSources);
      expect(
        cards.container.querySelectorAll(
          '[data-testid="live-card-thumbnail"][data-cache="reload"]',
        ),
      ).toHaveLength(2);
      cards.render(false, false);
      cards.render(false);
      expect(appState.imageMounts).toBe(8);
      expect(
        cards.container.querySelectorAll(
          '[data-testid="live-card-thumbnail"][data-cache="default"]',
        ),
      ).toHaveLength(2);
    } finally {
      cards.dispose();
    }
  });

  it("reads a changed provider thumbnail again without refreshing recorded media", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    let liveReads = 0;
    let videoReads = 0;
    function Catalog() {
      const live = useQuery({
        queryKey: ["discovery", "top-streams", "kick", "all"],
        queryFn: async () => {
          liveReads += 1;
          return {
            ...fixtureStream("kick", "changing", 50),
            thumbnailUrl: `https://images.kick.com/live/${liveReads}.webp`,
          };
        },
      });
      useQuery({
        queryKey: ["discovery", "videos", "kick", "channel"],
        queryFn: async () => {
          videoReads += 1;
          return "recorded";
        },
      });
      return live.data
        ? createElement(HomeStreamCard, { stream: live.data })
        : null;
    }
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            LiveStreamCardsProvider,
            { queryClient, showLargeStreamCards: false },
            createElement(Catalog),
          ),
        ),
      );
    });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    try {
      expect(liveReads).toBe(1);
      expect(videoReads).toBe(1);
      expect(
        container
          .querySelector('[data-testid="live-card-thumbnail"]')
          ?.getAttribute("src"),
      ).toBe("https://images.kick.com/live/1.webp");
      await act(async () => vi.advanceTimersByTimeAsync(300_000));
      await act(async () => vi.advanceTimersByTimeAsync(10));
      expect(liveReads).toBe(2);
      expect(videoReads).toBe(1);
      expect(
        queryClient.getQueryData<{ thumbnailUrl: string }>([
          "discovery",
          "top-streams",
          "kick",
          "all",
        ])?.thumbnailUrl,
      ).toBe("https://images.kick.com/live/2.webp");
      expect(
        container
          .querySelector('[data-testid="live-card-thumbnail"]')
          ?.getAttribute("src"),
      ).toBe("https://images.kick.com/live/2.webp");
    } finally {
      act(() => root.unmount());
      queryClient.clear();
    }
  });
});

describe("live card query refresh scope", () => {
  it("updates live card thumbnails from every source on the timer and foreground return", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    const category = {
      id: "123",
      name: "Music",
      platform: "twitch" as const,
      otherId: "456",
      boxArtUrl: "https://example.com/music.jpg",
    };
    const categoryRequest = defaultCategoryRequest(category, "all", "all");
    const sources = (["twitch", "kick"] as const).flatMap((platform) => [
      {
        id: `home-${platform}`,
        platform,
        queryKey: topStreamsQueryKey(platform),
      },
      {
        id: `category-${platform}`,
        platform,
        queryKey: categoryMediaQueryKey(categoryRequest, platform),
      },
      {
        id: `channel-${platform}`,
        platform,
        queryKey: channelQueryKey({
          platform,
          id: "channel",
          username: "live",
        }),
      },
      {
        id: `search-${platform}`,
        platform,
        queryKey: searchPageQueryKey(platform, "streams", "music", false),
      },
    ]);
    const reads = new Map<string, number>();
    function liveStream(id: string, platform: Platform) {
      const next = (reads.get(id) ?? 0) + 1;
      reads.set(id, next);
      return {
        ...fixtureStream(platform, id, 50),
        thumbnailUrl: `https://example.com/${id}/${next}.jpg`,
      };
    }
    function SourceCard({
      source,
    }: {
      readonly source: (typeof sources)[number];
    }) {
      const stream = useQuery({
        queryKey: source.queryKey,
        queryFn: () => liveStream(source.id, source.platform),
      });
      return stream.data
        ? createElement(HomeStreamCard, { stream: stream.data })
        : null;
    }
    function FollowingCards() {
      const following = useQuery({
        queryKey: followingQueryKey("live"),
        queryFn: () =>
          (["twitch", "kick"] as const).map((platform) =>
            liveStream(`following-${platform}`, platform),
          ),
      });
      return (
        following.data?.map((stream) =>
          createElement(FollowingStreamCard, {
            key: stream.id,
            stream,
            onOpen: () => {},
          }),
        ) ?? null
      );
    }
    const excludedReads = { channels: 0, categories: 0, recorded: 0 };
    function OtherSearchResults() {
      useQuery({
        queryKey: searchPageQueryKey("twitch", "channels", "music", false),
        queryFn: () => ++excludedReads.channels,
      });
      useQuery({
        queryKey: searchPageQueryKey("kick", "categories", "music", false),
        queryFn: () => ++excludedReads.categories,
      });
      useQuery({
        queryKey: ["discovery", "search-media", "twitch", "music"],
        queryFn: () => ++excludedReads.recorded,
      });
      return null;
    }
    function expectImages(version: number) {
      for (const source of sources) {
        expect(reads.get(source.id)).toBe(version);
        expect(
          container
            .querySelector(
              `[data-testid="home-stream-${source.platform}-${source.id}"] [data-testid="live-card-thumbnail"]`,
            )
            ?.getAttribute("src"),
        ).toBe(`https://example.com/${source.id}/${version}.jpg`);
      }
      for (const platform of ["twitch", "kick"] as const) {
        const id = `following-${platform}`;
        expect(reads.get(id)).toBe(version);
        expect(
          container
            .querySelector(
              `[data-testid="following-stream-${platform}-${id}"] [data-testid="live-card-thumbnail"]`,
            )
            ?.getAttribute("src"),
        ).toBe(`https://example.com/${id}/${version}.jpg`);
      }
    }
    try {
      await act(async () => {
        root.render(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(
              LiveStreamCardsProvider,
              { queryClient, showLargeStreamCards: false },
              ...sources.map((source) =>
                createElement(SourceCard, { key: source.id, source }),
              ),
              createElement(FollowingCards),
              createElement(OtherSearchResults),
            ),
          ),
        );
      });
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expectImages(1);
      expect(excludedReads).toEqual({
        channels: 1,
        categories: 1,
        recorded: 1,
      });

      await act(async () => vi.advanceTimersByTimeAsync(300_000));
      await act(async () => vi.advanceTimersByTimeAsync(10));
      expectImages(2);
      expect(excludedReads).toEqual({
        channels: 1,
        categories: 1,
        recorded: 1,
      });

      changeAppState("background");
      await act(async () => vi.advanceTimersByTimeAsync(600_000));
      expectImages(2);
      changeAppState("active");
      await act(async () => vi.advanceTimersByTimeAsync(10));
      expectImages(3);
      expect(excludedReads).toEqual({
        channels: 1,
        categories: 1,
        recorded: 1,
      });
    } finally {
      act(() => root.unmount());
      queryClient.clear();
    }
  });

  it("includes live catalog queries and excludes recorded media and settings", () => {
    expect(
      isLiveCardQueryKey(["discovery", "top-streams", "twitch", "all"]),
    ).toBe(true);
    expect(
      isLiveCardQueryKey(searchPageQueryKey("kick", "streams", "game", false)),
    ).toBe(true);
    expect(
      isLiveCardQueryKey([
        "discovery",
        "category-media",
        "twitch",
        "live",
        "123",
      ]),
    ).toBe(true);
    expect(
      isLiveCardQueryKey(["discovery", "channel", "kick", "44", "name"]),
    ).toBe(true);
    expect(isLiveCardQueryKey(["follows", "live"])).toBe(true);
    expect(
      isLiveCardQueryKey([
        "discovery",
        "category-media",
        "twitch",
        "videos",
        "123",
      ]),
    ).toBe(false);
    expect(
      isLiveCardQueryKey(["discovery", "videos", "twitch", "44", "name"]),
    ).toBe(false);
    expect(isLiveCardQueryKey(["follows", "recorded", "videos"])).toBe(false);
    expect(isLiveCardQueryKey(["settings", "preferences"])).toBe(false);
  });
});
