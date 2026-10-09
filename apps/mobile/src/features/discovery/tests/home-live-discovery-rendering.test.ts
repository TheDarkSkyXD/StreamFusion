// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FlatListProps } from "react-native";
import type { Stream } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";
import { getDisplayLanguage } from "@streamfusion/core/display-language";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DiscoverySession,
  PlatformReadOutcome,
} from "../capabilities/platform-reads";
import { HomeLiveDiscoveryScreen } from "../components/home-live-discovery-screen";
import { topStreamsQueryKey } from "../components/use-home-live-discovery";
import { fixtureOutcome, fixtureStream } from "../domain/discovery-fixture";

const renderedCards = vi.hoisted(() => new Map<string, number>());
const listWindow = vi.hoisted(() => ({ limit: Infinity, dataCount: 0 }));

vi.mock("../components/live-stream-card-content", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../components/live-stream-card-content")
    >();
  return {
    ...original,
    LiveStreamCardContent(
      props: ComponentProps<typeof original.LiveStreamCardContent>,
    ) {
      const key = `${props.stream.platform}:${props.stream.id}`;
      renderedCards.set(key, (renderedCards.get(key) ?? 0) + 1);
      return createElement(original.LiveStreamCardContent, props);
    },
  };
});

vi.mock("react-native", () => {
  function host(props: {
    readonly children?: ReactNode;
    readonly testID?: string;
    readonly accessibilityLabel?: string;
    readonly onPress?: () => void;
  }) {
    return createElement(
      "div",
      {
        "aria-label": props.accessibilityLabel,
        "data-testid": props.testID,
        role: props.onPress ? "button" : undefined,
        onClick: props.onPress,
      },
      props.children,
    );
  }
  function slot(value: FlatListProps<Stream>["ListHeaderComponent"]) {
    return typeof value === "function" ? createElement(value) : value;
  }
  return {
    View: host,
    Text: host,
    Pressable: host,
    ScrollView: host,
    Image: () => null,
    RefreshControl: () => null,
    FlatList(props: FlatListProps<Stream>) {
      listWindow.dataCount = props.data?.length ?? 0;
      return createElement(
        "div",
        { "data-testid": props.testID },
        slot(props.ListHeaderComponent),
        props.data?.slice(0, listWindow.limit).map((item, index) =>
          createElement(
            "div",
            {
              key: props.keyExtractor?.(item, index) ?? item.id,
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
          ),
        ),
        slot(props.ListFooterComponent),
      );
    },
    useWindowDimensions: () => ({
      width: 390,
      height: 844,
      scale: 2,
      fontScale: 1,
    }),
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  };
});

vi.mock("react-native-svg", () => {
  const host = ({ children }: { readonly children?: ReactNode }) =>
    createElement("div", null, children);
  return {
    default: host,
    Defs: host,
    LinearGradient: host,
    Path: host,
    Rect: host,
    Stop: host,
  };
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  renderedCards.clear();
  listWindow.limit = Infinity;
  listWindow.dataCount = 0;
  vi.useRealTimers();
});

async function mountDiscovery(streamsPerProvider = 4) {
  const outcomes: Record<Platform, PlatformReadOutcome<Stream>> = {
    twitch: {
      ...fixtureOutcome("twitch", "ready"),
      items: Array.from({ length: streamsPerProvider }, (_, index) =>
        fixtureStream("twitch", `t${index}`, 100 - index),
      ),
    },
    kick: {
      ...fixtureOutcome("kick", "ready"),
      items: Array.from({ length: streamsPerProvider }, (_, index) =>
        fixtureStream("kick", `k${index}`, 50 - index),
      ),
    },
  };
  const unavailable = async (): Promise<never> => {
    throw new Error("Unexpected discovery read");
  };
  const session: DiscoverySession = {
    readTopStreams: async ({ platform }) => outcomes[platform],
    readCategories: unavailable,
    searchCategories: unavailable,
    readCategory: unavailable,
    readCategoryStreams: unavailable,
    readCategoryClips: unavailable,
    readCategoryVideos: unavailable,
    search: unavailable,
    readChannel: unavailable,
    readChannelVideos: unavailable,
    readChannelClips: unavailable,
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  for (const platform of ["twitch", "kick"] satisfies Platform[]) {
    queryClient.setQueryData(
      topStreamsQueryKey(platform),
      await session.readTopStreams({ platform }),
    );
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  let onSelectStream = (stream: Stream) => selected.push(stream.title);
  const selected: string[] = [];
  function render() {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(HomeLiveDiscoveryScreen, {
          onOpenAccounts() {},
          onSelectStream,
          session,
          title: "Watch",
        }),
      ),
    );
  }
  await act(async () => render());
  function click(testID: string) {
    const button = container.querySelector(`[data-testid="${testID}"]`);
    if (!(button instanceof HTMLElement))
      throw new Error(`Missing button ${testID}`);
    act(() => button.click());
  }
  return {
    container,
    selected,
    click,
    outcomes,
    queryClient,
    changeSelectionHandler(handler: (stream: Stream) => void) {
      onSelectStream = handler;
      act(() => render());
    },
    dispose() {
      act(() => root.unmount());
      queryClient.clear();
    },
  };
}

async function mountLiveReads(
  readTopStreams: DiscoverySession["readTopStreams"],
  language?: string,
) {
  const unavailable = async (): Promise<never> => {
    throw new Error("Unexpected discovery read");
  };
  const session: DiscoverySession = {
    readTopStreams,
    readCategories: unavailable,
    searchCategories: unavailable,
    readCategory: unavailable,
    readCategoryStreams: unavailable,
    readCategoryClips: unavailable,
    readCategoryVideos: unavailable,
    search: unavailable,
    readChannel: unavailable,
    readChannelVideos: unavailable,
    readChannelClips: unavailable,
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(HomeLiveDiscoveryScreen, {
          onOpenAccounts() {},
          session,
          title: "Watch",
          ...(language === undefined ? {} : { language }),
        }),
      ),
    );
  });
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    container,
    queryClient,
    dispose() {
      act(() => root.unmount());
      queryClient.clear();
    },
  };
}

describe("Watch discovery recommendation rendering", () => {
  it("uses the Settings display language for provider reads and cache keys", async () => {
    for (const displayLanguage of ["fil", "zh-TW"] as const) {
      const language = getDisplayLanguage(displayLanguage).streamLanguage;
      const reads: { platform: Platform; language?: string }[] = [];
      const screen = await mountLiveReads(
        async (read) => {
          reads.push(read);
          return fixtureOutcome(read.platform, "ready");
        },
        language,
      );
      try {
        expect(language).toBe(displayLanguage === "fil" ? "tl" : "zh");
        expect(reads).toEqual([
          { platform: "twitch", language, signal: expect.any(AbortSignal) },
          { platform: "kick", language, signal: expect.any(AbortSignal) },
        ]);
        expect(
          screen.queryClient.getQueryData(topStreamsQueryKey("twitch", language)),
        ).toBeDefined();
        expect(
          screen.queryClient.getQueryData(topStreamsQueryKey("kick", language)),
        ).toBeDefined();
      } finally {
        screen.dispose();
      }
    }
  });

  it("shows loading without failure banners before reads settle, then shows the ready peer", async () => {
    let resolveTwitch: (value: PlatformReadOutcome<Stream>) => void = () =>
      undefined;
    let resolveKick: (value: PlatformReadOutcome<Stream>) => void = () =>
      undefined;
    const screen = await mountLiveReads(
      ({ platform }) =>
        new Promise((resolve) => {
          if (platform === "twitch") resolveTwitch = resolve;
          else resolveKick = resolve;
        }),
    );
    try {
      expect(
        screen.container.querySelector('[data-testid="home-phase"]')
          ?.textContent,
      ).toContain("Loading");
      expect(
        screen.container.querySelector('[data-testid="home-banner-twitch"]'),
      ).toBeNull();
      expect(
        screen.container.querySelector('[data-testid="home-banner-kick"]'),
      ).toBeNull();
      await act(async () => {
        resolveTwitch(fixtureOutcome("twitch", "ready"));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(
        screen.container
          .querySelector('[data-testid="home-stream-twitch-twitch-ready"]'),
      ).not.toBeNull();
      expect(
        screen.container.querySelector('[data-testid="home-banner-kick"]'),
      ).toBeNull();
    } finally {
      await act(async () => resolveKick(fixtureOutcome("kick", "ready")));
      screen.dispose();
    }
  });

  it("recovers a failed provider automatically without rereading the healthy peer", async () => {
    vi.useFakeTimers();
    const calls: Record<Platform, number> = { twitch: 0, kick: 0 };
    const screen = await mountLiveReads(async ({ platform }) => {
      calls[platform] += 1;
      return platform === "twitch" && calls.twitch === 1
        ? fixtureOutcome("twitch", "twitch-fail")
        : fixtureOutcome(platform, "ready");
    });
    try {
      expect(calls).toEqual({ twitch: 1, kick: 1 });
      expect(
        screen.container.querySelector('[data-testid="home-retry-twitch"]'),
      ).toBeNull();
      expect(
        screen.container.querySelector('[data-testid="home-banner-twitch"]')
          ?.textContent,
      ).toContain("Reconnecting");
      await act(async () => vi.advanceTimersByTimeAsync(5_000));
      await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(calls).toEqual({ twitch: 2, kick: 1 });
      expect(
        screen.container
          .querySelector('[data-testid="home-stream-twitch-twitch-ready"]'),
      ).not.toBeNull();
      expect(
        screen.container.querySelector('[data-testid="home-banner-twitch"]'),
      ).toBeNull();
    } finally {
      screen.dispose();
    }
  });

  it("keeps sign in available without looping on terminal auth failure", async () => {
    vi.useFakeTimers();
    let twitchReads = 0;
    const screen = await mountLiveReads(async ({ platform }) => {
      if (platform === "twitch") {
        twitchReads += 1;
        return fixtureOutcome("twitch", "auth-lost");
      }
      return fixtureOutcome("kick", "ready");
    });
    try {
      expect(
        screen.container.querySelector('[data-testid="home-login-twitch"]'),
      ).not.toBeNull();
      expect(
        screen.container.querySelector('[data-testid="home-retry-twitch"]'),
      ).toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(15_000));
      expect(twitchReads).toBe(1);
    } finally {
      screen.dispose();
    }
  });

  it("refreshes an offline cached provider when the connection returns", async () => {
    vi.useFakeTimers();
    let twitchReads = 0;
    const screen = await mountLiveReads(async ({ platform }) => {
      if (platform === "twitch") {
        twitchReads += 1;
        return fixtureOutcome(
          "twitch",
          twitchReads === 1 ? "stale-cache" : "ready",
        );
      }
      return fixtureOutcome("kick", "ready");
    });
    try {
      expect(
        screen.container.querySelector('[data-testid="home-cache-age-twitch"]'),
      ).not.toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(5_100));
      expect(twitchReads).toBe(2);
      expect(
        screen.container.querySelector('[data-testid="home-cache-age-twitch"]'),
      ).toBeNull();
    } finally {
      screen.dispose();
    }
  });

  it("retries a thrown read while Watch remains mounted", async () => {
    vi.useFakeTimers();
    let twitchReads = 0;
    const screen = await mountLiveReads(async ({ platform }) => {
      if (platform === "twitch") {
        twitchReads += 1;
        if (twitchReads === 1) throw new Error("network down");
      }
      return fixtureOutcome(platform, "ready");
    });
    try {
      expect(
        screen.container.querySelector('[data-testid="home-banner-twitch"]'),
      ).toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(5_100));
      expect(twitchReads).toBe(2);
      expect(
        screen.container
          .querySelector('[data-testid="home-stream-twitch-twitch-ready"]'),
      ).not.toBeNull();
    } finally {
      screen.dispose();
    }
  });
  it("defers offscreen card work to the native list while retaining the full catalog", async () => {
    listWindow.limit = 3;
    const screen = await mountDiscovery(50);
    try {
      expect(listWindow.dataCount).toBe(100);
      expect(renderedCards).toEqual(
        new Map([
          ["twitch:t0", 1],
          ["twitch:t1", 1],
          ["twitch:t2", 1],
        ]),
      );
      expect(
        screen.container.querySelector('[data-testid="home-stream-twitch-t0"]')
          ?.textContent,
      ).toContain("Twitch catalog proof stream");
      screen.click("home-stream-twitch-t0");
      expect(screen.selected).toEqual(["Twitch catalog proof stream"]);
    } finally {
      screen.dispose();
    }
  });

  it("renders updated stream content and uses the latest stream selection handler", async () => {
    const screen = await mountDiscovery();
    try {
      const updated = {
        ...screen.outcomes.kick,
        items: screen.outcomes.kick.items.map((stream) =>
          stream.id === "k0"
            ? { ...stream, title: "Updated live stream" }
            : stream,
        ),
      };
      await act(async () => {
        screen.queryClient.setQueryData(topStreamsQueryKey("kick"), updated);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(
        screen.container.querySelector('[data-testid="home-stream-kick-k0"]')
          ?.textContent,
      ).toContain("Updated live stream");
      screen.click("home-stream-kick-k0");
      expect(screen.selected).toEqual(["Updated live stream"]);
      const changedHandlerSelections: string[] = [];
      screen.changeSelectionHandler((stream) =>
        changedHandlerSelections.push(stream.title),
      );
      screen.click("home-stream-kick-k0");
      expect(changedHandlerSelections).toEqual(["Updated live stream"]);
      expect(screen.selected).toEqual(["Updated live stream"]);
    } finally {
      screen.dispose();
    }
  });
});
