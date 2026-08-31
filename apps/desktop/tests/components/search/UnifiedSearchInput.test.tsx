import { act, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, routerMock, screen } from "../../test-utils";

vi.mock("@tanstack/react-router", () => routerMock());

// Hoisted state lets each test override the mocked infinite-query return
// (data shape, hasNextPage, fetchNextPage spy) without re-registering
// vi.mock — the factory closes over these references.
const searchMockState = vi.hoisted(() => ({
  channelsData: { pages: [] as { data: unknown[] }[] },
  channelsHasNextPage: false,
  channelsFetchNextPage: vi.fn(),
  useSearchChannels: vi.fn(),
  channelQueryOverrides: {} as Record<
    string,
    Record<string, unknown> | ((...args: unknown[]) => Record<string, unknown>)
  >,
  categoriesData: { pages: [] as { data: unknown[] }[] },
  categoriesHasNextPage: false,
  categoriesFetchNextPage: vi.fn(),
  useSearchCategories: vi.fn(),
}));

const historyMockState = vi.hoisted(() => ({
  historyByScope: {
    channels: [] as string[],
    categories: [] as string[],
    streams: [] as string[],
  },
  addSearch: vi.fn(),
  removeSearch: vi.fn(),
  clearHistory: vi.fn(),
}));

const routeMockState = vi.hoisted(() => ({
  preloadSearchPage: vi.fn(() => Promise.resolve()),
}));

const searchPageModuleMockState = vi.hoisted(() => ({
  loaded: vi.fn(),
}));

vi.mock("@/features/discovery/data/queries/useSearch", () => ({
  useSearchChannels: (...args: unknown[]) => {
    searchMockState.useSearchChannels(...args);
    const configuredOverride = searchMockState.channelQueryOverrides[String(args[1] ?? "all")];
    const queryOverride =
      typeof configuredOverride === "function" ? configuredOverride(...args) : configuredOverride;
    return {
      data: searchMockState.channelsData,
      isLoading: false,
      fetchNextPage: searchMockState.channelsFetchNextPage,
      hasNextPage: searchMockState.channelsHasNextPage,
      isFetchingNextPage: false,
      ...(queryOverride ?? {}),
    };
  },
  useSearchCategories: (...args: unknown[]) => {
    searchMockState.useSearchCategories(...args);
    return {
      data: searchMockState.categoriesData,
      isLoading: false,
      fetchNextPage: searchMockState.categoriesFetchNextPage,
      hasNextPage: searchMockState.categoriesHasNextPage,
      isFetchingNextPage: false,
    };
  },
}));

vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: <T,>(v: T) => v,
}));

vi.mock("@/features/discovery/data/useSearchHistory", () => ({
  useSearchHistory: (scope: "channels" | "categories" | "streams" = "channels") => ({
    history: historyMockState.historyByScope[scope],
    historyByScope: historyMockState.historyByScope,
    addSearch: historyMockState.addSearch,
    removeSearch: historyMockState.removeSearch,
    clearHistory: historyMockState.clearHistory,
  }),
}));

vi.mock("@/features/discovery/data/queries/useCategories", () => ({
  useUnifiedCategoryLink: () => ({
    linkPlatform: "twitch",
    linkCategoryId: "cat-1",
    otherId: undefined,
  }),
}));

vi.mock("@/components/ui/proxied-image", () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

vi.mock("@/features/discovery/routes/search-page", () => ({
  preloadSearchPage: routeMockState.preloadSearchPage,
}));

vi.mock("@/pages/SearchResults", () => {
  searchPageModuleMockState.loaded();
  return { SearchPage: () => null };
});

import { UnifiedSearchInput } from "@/features/discovery/components/search/UnifiedSearchInput";

function makeChannels(count: number, prefix = "ch") {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    platform: "twitch" as const,
    username: `${prefix}${i}`,
    displayName: `${prefix.toUpperCase()}${i}`,
    avatarUrl: "",
    bio: undefined,
    isLive: false,
    isVerified: false,
    isPartner: false,
    followerCount: 0,
  }));
}

function makeCategories(count: number, prefix = "cat") {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    platform: "twitch" as const,
    name: `${prefix.toUpperCase()} ${i}`,
    slug: `${prefix}-${i}`,
    boxArtUrl: "",
    viewerCount: 0,
    tags: [],
  }));
}

function resetSearchMock() {
  searchMockState.channelsData = { pages: [] };
  searchMockState.channelsHasNextPage = false;
  // Mirror useInfiniteQuery's contract: fetchNextPage returns a Promise.
  // The dropdown's scroll-latch uses .finally() on the result.
  searchMockState.channelsFetchNextPage = vi.fn(() => Promise.resolve());
  searchMockState.useSearchChannels.mockClear();
  searchMockState.channelQueryOverrides = {};
  searchMockState.categoriesData = { pages: [] };
  searchMockState.categoriesHasNextPage = false;
  searchMockState.categoriesFetchNextPage = vi.fn(() => Promise.resolve());
  searchMockState.useSearchCategories.mockClear();
}

function resetHistoryMock() {
  historyMockState.historyByScope = {
    channels: [],
    categories: [],
    streams: [],
  };
  historyMockState.addSearch.mockClear();
  historyMockState.removeSearch.mockClear();
  historyMockState.clearHistory.mockClear();
}

// Guards: loading state — debounced fetch in flight (useDebounce stub returns the value immediately here) lets the dropdown still mount on focus while the next page resolves
// Guards: error/empty state — useSearchChannels / useSearchCategories returning empty pages leaves the dropdown without items; "See all results" CTA still renders so users have a way forward
// Guards: dedup absorption — when a page arrives with zero net new IDs (Twitch re-serves under a fresh cursor), the dropdown must not auto-fetch the next page. Without this the dropdown loops forever
// Guards: an optional favorite action is a separate accessible control that never selects the channel or collapses the picker
// Guards: channel-only pickers disable category IPC so hidden categories cannot consume platform-search capacity.
// Guards: Twitch matches remain visible while the parallel Kick request is still loading.
// Guards: live-only stream pickers pass their constraint through to platform search, preserving Kick fallback correctness.
// Guards: inactive autocomplete tabs do not start provider work that cannot yet render.
// Guards: one-letter cross-platform autocomplete retrieves enough exact/prefix candidates to render at least five Channels rows, excluding Best Match.
// Guards: one-letter autocomplete does not relax substring/fuzzy relevance when the expanded provider page has fewer than five strong Channels candidates.
// Guards: search focus delegates page loading to the route preload owner.
describe("UnifiedSearchInput", () => {
  beforeEach(() => {
    resetSearchMock();
    resetHistoryMock();
    routeMockState.preloadSearchPage.mockClear();
    searchPageModuleMockState.loaded.mockClear();
  });

  it("renders an input with the placeholder", () => {
    renderWithProviders(<UnifiedSearchInput placeholder="Search the world" />);
    const input = screen.getByPlaceholderText("Search the world");
    expect(input).toBeInTheDocument();
    expect(input).toHaveClass("bg-neutral-800", "border-neutral-700", "text-white");
  });

  it("preloads Search Results through the route lifecycle on focus", async () => {
    renderWithProviders(<UnifiedSearchInput />);

    fireEvent.focus(screen.getByRole("textbox"));
    await vi.dynamicImportSettled();

    expect(routeMockState.preloadSearchPage).toHaveBeenCalledTimes(1);
    expect(searchPageModuleMockState.loaded).not.toHaveBeenCalled();
  });

  it("honors initialValue", () => {
    renderWithProviders(<UnifiedSearchInput initialValue="ninja" />);
    expect(screen.getByDisplayValue("ninja")).toBeInTheDocument();
  });

  it("calls onSearch when Enter is pressed", () => {
    const onSearch = vi.fn();
    renderWithProviders(<UnifiedSearchInput onSearch={onSearch} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "xqc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSearch).toHaveBeenCalledWith("xqc");
  });

  it("renders channel, category, and stream tabs in the dropdown", () => {
    renderWithProviders(<UnifiedSearchInput />);
    fireEvent.focus(screen.getByRole("textbox"));
    expect(screen.getByRole("tab", { name: "Channels" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Categories" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Streams" })).toBeInTheDocument();
  });

  it("keeps channel-only pickers tabless when categories are disabled", () => {
    renderWithProviders(<UnifiedSearchInput showCategories={false} />);
    fireEvent.focus(screen.getByRole("textbox"));
    expect(screen.queryByRole("tablist", { name: "Search type" })).not.toBeInTheDocument();
  });

  it("does not enable category searches for a channel-only picker", () => {
    renderWithProviders(<UnifiedSearchInput initialValue="ninja" showCategories={false} />);

    expect(searchMockState.useSearchCategories).toHaveBeenCalledTimes(3);
    expect(searchMockState.useSearchCategories.mock.calls.every((call) => call[3] === false)).toBe(
      true
    );
  });

  it("activates only the selected autocomplete result type", () => {
    renderWithProviders(<UnifiedSearchInput initialValue="creator" />);
    fireEvent.focus(screen.getByRole("textbox"));

    expect(searchMockState.useSearchCategories.mock.calls.every((call) => call[3] === false)).toBe(
      true
    );
    expect(
      searchMockState.useSearchChannels.mock.calls.some(
        (call) => call[0] === "creator" && call[1] === "twitch"
      )
    ).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: "Categories" }));

    expect(
      searchMockState.useSearchCategories.mock.calls.slice(-3).every((call) => call[3] === true)
    ).toBe(true);
    expect(
      searchMockState.useSearchChannels.mock.calls.slice(-3).every((call) => call[0] === "")
    ).toBe(true);
  });

  it("filters channel-only picker suggestions to live channels when requested", () => {
    searchMockState.channelsData = {
      pages: [
        {
          data: [
            {
              ...makeChannels(1, "offline")[0],
              displayName: "OfflineMatch",
              username: "offline",
              isLive: false,
            },
            {
              ...makeChannels(1, "live")[0],
              displayName: "LiveMatch",
              username: "live",
              isLive: true,
            },
          ],
        },
      ],
    };

    renderWithProviders(
      <UnifiedSearchInput
        initialValue="match"
        platform="twitch"
        showCategories={false}
        liveOnlyChannels
      />
    );
    fireEvent.focus(screen.getByRole("textbox"));

    expect(screen.getByText("LiveMatch")).toBeInTheDocument();
    expect(screen.queryByText("OfflineMatch")).not.toBeInTheDocument();
  });

  it("requests live-only channel candidates for a stream picker", () => {
    renderWithProviders(
      <UnifiedSearchInput initialValue="creator" showCategories={false} liveOnlyChannels />
    );

    expect(searchMockState.useSearchChannels).toHaveBeenCalledTimes(3);
    expect(searchMockState.useSearchChannels.mock.calls.every((call) => call[3] === true)).toBe(
      true
    );
  });

  it("keeps a ready Twitch match visible while Kick is still pending", () => {
    const twitchMatch = { ...makeChannels(1, "twitch")[0], displayName: "TwitchMatch" };
    searchMockState.channelQueryOverrides = {
      twitch: { data: { pages: [{ data: [twitchMatch] }] }, isLoading: false },
      kick: { data: { pages: [] }, isLoading: true },
    };

    renderWithProviders(<UnifiedSearchInput initialValue="match" showCategories={false} />);
    fireEvent.focus(screen.getByRole("textbox"));

    expect(screen.getByText("TwitchMatch")).toBeInTheDocument();
  });

  it("continues a one-letter provider search until at least five Channels suggestions render", async () => {
    const exact = {
      ...makeChannels(1, "exact-a")[0],
      platform: "kick" as const,
      username: "a",
      displayName: "A",
    };
    const prefixes = ["Atlas", "Aurora", "Axiom", "Alpine", "Arcade"].map((displayName, index) => ({
      ...makeChannels(1, `a-prefix-${index}`)[0],
      username: displayName.toLowerCase(),
      displayName,
    }));
    searchMockState.channelQueryOverrides = {
      twitch: {
        data: { pages: [{ data: prefixes.slice(0, 3) }] },
        hasNextPage: true,
      },
      kick: {
        data: { pages: [{ data: [exact] }] },
        hasNextPage: false,
      },
    };

    const view = renderWithProviders(
      <UnifiedSearchInput initialValue="a" showCategories={false} />
    );
    fireEvent.focus(screen.getByRole("textbox"));

    await waitFor(() => expect(searchMockState.channelsFetchNextPage).toHaveBeenCalledTimes(1));

    searchMockState.channelQueryOverrides.twitch = {
      data: {
        pages: [{ data: prefixes.slice(0, 3) }, { data: prefixes.slice(3, 4) }],
      },
      hasNextPage: true,
    };
    view.rerender(<UnifiedSearchInput initialValue="a" showCategories={false} />);

    await waitFor(() => expect(searchMockState.channelsFetchNextPage).toHaveBeenCalledTimes(2));

    searchMockState.channelQueryOverrides.twitch = {
      data: {
        pages: [
          { data: prefixes.slice(0, 3) },
          { data: prefixes.slice(3, 4) },
          { data: prefixes.slice(4) },
        ],
      },
      hasNextPage: false,
    };
    view.rerender(<UnifiedSearchInput initialValue="a" showCategories={false} />);

    const bestMatchSection = screen.getByRole("heading", { name: "Best Match" }).parentElement;
    const channelsSection = screen.getByRole("heading", { name: "Channels" }).parentElement;
    expect(bestMatchSection?.querySelectorAll("a")).toHaveLength(1);
    expect(channelsSection?.querySelectorAll("a").length).toBeGreaterThanOrEqual(5);
  });

  it("does not fill a one-letter Channels section with weak matches", () => {
    const exact = {
      ...makeChannels(1, "exact-a")[0],
      username: "a",
      displayName: "A",
    };
    const prefixes = ["Atlas", "Aurora", "Axiom"].map((displayName, index) => ({
      ...makeChannels(1, `a-prefix-${index}`)[0],
      username: displayName.toLowerCase(),
      displayName,
    }));
    const substring = {
      ...makeChannels(1, "substring-a")[0],
      username: "beta",
      displayName: "Beta",
    };
    const fuzzy = {
      ...makeChannels(1, "fuzzy-a")[0],
      username: "b",
      displayName: "B",
    };
    searchMockState.channelQueryOverrides = {
      twitch: { data: { pages: [{ data: [exact, ...prefixes, substring, fuzzy] }] } },
      kick: { data: { pages: [] } },
    };

    renderWithProviders(<UnifiedSearchInput initialValue="a" showCategories={false} />);
    fireEvent.focus(screen.getByRole("textbox"));

    const bestMatchSection = screen.getByRole("heading", { name: "Best Match" }).parentElement;
    const channelsSection = screen.getByRole("heading", { name: "Channels" }).parentElement;
    expect(bestMatchSection?.querySelectorAll("a")).toHaveLength(1);
    expect(channelsSection?.querySelectorAll("a")).toHaveLength(3);
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    expect(screen.queryByText("B")).not.toBeInTheDocument();
  });

  it("uses exact, prefix, then substring relevance across provider suggestions", () => {
    const exact = {
      ...makeChannels(1, "exact")[0],
      id: "exact-kick",
      platform: "kick" as const,
      username: "creator",
      displayName: "Creator",
      followerCount: 0,
    };
    const prefix = {
      ...makeChannels(1, "prefix")[0],
      id: "prefix-kick",
      platform: "kick" as const,
      username: "creatorstudio",
      displayName: "Creator Studio",
      followerCount: 20,
    };
    const substring = {
      ...makeChannels(1, "substring")[0],
      id: "substring-twitch",
      username: "thecreator",
      displayName: "The Creator",
      followerCount: 1_000_000,
      isLive: true,
    };
    searchMockState.channelQueryOverrides = {
      twitch: { data: { pages: [{ data: [substring] }] } },
      kick: { data: { pages: [{ data: [prefix, exact] }] } },
    };

    renderWithProviders(<UnifiedSearchInput initialValue="creator" showCategories={false} />);
    fireEvent.focus(screen.getByRole("textbox"));

    const idByUsername = new Map(
      [exact, prefix, substring].map((channel) => [channel.username, channel.id])
    );
    const orderedIds = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("data-params"))
      .filter((params): params is string => Boolean(params))
      .map((params) => idByUsername.get(JSON.parse(params).channel))
      .filter((id): id is string => Boolean(id));
    expect(orderedIds).toEqual(["exact-kick", "prefix-kick", "substring-twitch"]);
  });

  it("renders a real zero follower count while omitting a missing count", () => {
    const missing = {
      ...makeChannels(1, "missing")[0],
      username: "creatormissing",
      displayName: "Creator Missing",
      followerCount: undefined,
    };
    const realZero = {
      ...makeChannels(1, "zero")[0],
      username: "creatorzero",
      displayName: "Creator Zero",
      followerCount: 0,
    };
    searchMockState.channelsData = { pages: [{ data: [missing, realZero] }] };

    renderWithProviders(
      <UnifiedSearchInput initialValue="creator" platform="twitch" showCategories={false} />
    );
    fireEvent.focus(screen.getByRole("textbox"));

    const zeroRow = screen.getByText("Creator Zero").closest("a, button");
    const missingRow = screen.getByText("Creator Missing").closest("a, button");
    expect(zeroRow).toHaveTextContent("0 followers");
    expect(missingRow).not.toHaveTextContent("followers");
  });

  it("keeps the favorite action separate from the channel selection button", () => {
    const channel = { ...makeChannels(1, "favorite")[0], displayName: "FavoriteMatch" };
    searchMockState.channelsData = { pages: [{ data: [channel] }] };
    const onSelectChannel = vi.fn();
    const onToggleChannelFavorite = vi.fn();

    renderWithProviders(
      <UnifiedSearchInput
        initialValue="favorite"
        platform="twitch"
        showCategories={false}
        onSelectChannel={onSelectChannel}
        isChannelFavorite={() => false}
        onToggleChannelFavorite={onToggleChannelFavorite}
      />
    );
    fireEvent.focus(screen.getByRole("textbox"));

    fireEvent.mouseDown(screen.getByRole("button", { name: "Add FavoriteMatch to favorites" }));
    fireEvent.click(screen.getByRole("button", { name: "Add FavoriteMatch to favorites" }));

    expect(onToggleChannelFavorite).toHaveBeenCalledWith(channel);
    expect(onSelectChannel).not.toHaveBeenCalled();
    expect(screen.getByText("FavoriteMatch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add FavoriteMatch to favorites" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );

    fireEvent.click(screen.getByText("FavoriteMatch").closest("button")!);
    expect(onSelectChannel).toHaveBeenCalledWith(channel);
  });

  it("shows history for the selected search tab", () => {
    historyMockState.historyByScope = {
      channels: ["ninja"],
      categories: ["Just Chatting"],
      streams: ["speedrun"],
    };

    renderWithProviders(<UnifiedSearchInput />);
    fireEvent.focus(screen.getByRole("textbox"));

    expect(screen.getByText("ninja")).toBeInTheDocument();
    expect(screen.queryByText("Just Chatting")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Categories" }));

    expect(screen.getByText("Just Chatting")).toBeInTheDocument();
    expect(screen.queryByText("ninja")).not.toBeInTheDocument();
  });

  it("renders history rows at Kick-sized scale", () => {
    historyMockState.historyByScope = {
      channels: ["ninja"],
      categories: [],
      streams: [],
    };

    renderWithProviders(<UnifiedSearchInput />);
    fireEvent.focus(screen.getByRole("textbox"));

    const removeButton = screen.getByLabelText('Remove "ninja" from history');
    const historyText = screen.getByText("ninja");
    const icons = removeButton.parentElement?.querySelectorAll("svg");

    expect(removeButton).toHaveClass("size-8");
    expect(removeButton.parentElement).toHaveClass("h-14");
    expect(historyText).toHaveClass("text-base", "font-semibold", "text-white");
    expect(icons?.[0]).toHaveAttribute("width", "20");
    expect(icons?.[1]).toHaveAttribute("width", "20");
  });

  it("stores submitted terms in the active tab history", () => {
    renderWithProviders(<UnifiedSearchInput onSearch={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole("tab", { name: "Categories" }));
    fireEvent.change(input, { target: { value: "minecraft" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(historyMockState.addSearch).toHaveBeenCalledWith("minecraft", "categories");
  });

  it("shows category results only after the category tab is selected", () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(1, "game") }] };
    searchMockState.categoriesData = { pages: [{ data: makeCategories(1, "game") }] };

    renderWithProviders(<UnifiedSearchInput initialValue="game" />);
    fireEvent.focus(screen.getByRole("textbox"));

    expect(screen.queryByText("GAME 0")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Categories" }));
    expect(screen.getByText("GAME 0")).toBeInTheDocument();
  });

  it("renders a platform partner badge beside verified channel suggestions", () => {
    searchMockState.channelsData = {
      pages: [
        {
          data: [
            {
              ...makeChannels(1, "partner")[0],
              displayName: "PartneredStreamer",
              isPartner: true,
            },
          ],
        },
      ],
    };

    renderWithProviders(<UnifiedSearchInput initialValue="partner" platform="twitch" />);
    fireEvent.focus(screen.getByRole("textbox"));

    expect(screen.getByLabelText("Twitch verified")).toBeInTheDocument();
  });
});

describe("UnifiedSearchInput — unbounded dropdown pagination", () => {
  beforeEach(() => {
    resetSearchMock();
    resetHistoryMock();
  });

  function openDropdown(initialValue: string, onSearch = vi.fn()) {
    renderWithProviders(<UnifiedSearchInput initialValue={initialValue} onSearch={onSearch} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    return { input, onSearch };
  }

  it('renders the "See all results" shortcut while more dropdown pages remain', () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(30) }] };
    searchMockState.channelsHasNextPage = true;
    openDropdown("ninja");
    expect(screen.getByText('See all results for "ninja"')).toBeInTheDocument();
  });

  it("renders channel suggestions and the results CTA for a one-letter query", () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(3, "a") }] };
    openDropdown("A");
    expect(screen.getByText("A0")).toBeInTheDocument();
    expect(screen.getByText('See all results for "A"')).toBeInTheDocument();
  });

  it("keeps pagination available after more than 100 results", () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(100) }] };
    searchMockState.channelsHasNextPage = true;
    openDropdown("ninja");
    expect(screen.getByText('See all results for "ninja"')).toBeInTheDocument();

    const scrollable = document.querySelector("div.overflow-y-auto") as HTMLElement | null;
    expect(scrollable).not.toBeNull();
    if (!scrollable) return;

    Object.defineProperty(scrollable, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(scrollable, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(scrollable, "scrollTop", { value: 1700, configurable: true });
    fireEvent.scroll(scrollable);

    expect(searchMockState.channelsFetchNextPage).toHaveBeenCalledTimes(2);
    expect(searchMockState.categoriesFetchNextPage).not.toHaveBeenCalled();
  });

  it("routes the footer shortcut through onSearch", () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(100) }] };
    const { onSearch } = openDropdown("ninja");
    fireEvent.click(screen.getByText('See all results for "ninja"'));
    expect(onSearch).toHaveBeenCalledWith("ninja");
  });

  it("triggers fetchNextPage on near-bottom scroll when more pages exist", () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(30) }] };
    searchMockState.channelsHasNextPage = true;
    openDropdown("ninja");

    const scrollable = document.querySelector("div.overflow-y-auto") as HTMLElement | null;
    expect(scrollable).not.toBeNull();
    if (!scrollable) return;

    Object.defineProperty(scrollable, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(scrollable, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(scrollable, "scrollTop", { value: 1700, configurable: true });
    fireEvent.scroll(scrollable);

    expect(searchMockState.channelsFetchNextPage).toHaveBeenCalledTimes(2);
  });

  it("stops auto-fetching after dedup absorbs a page (zero net new unique IDs on a new page)", async () => {
    // Page 1: 30 unique channels.
    const page1 = makeChannels(30);
    searchMockState.channelsData = { pages: [{ data: page1 }] };
    searchMockState.channelsHasNextPage = true;

    const { rerender } = renderWithProviders(<UnifiedSearchInput initialValue="ninja" />);
    fireEvent.focus(screen.getByRole("textbox"));

    // Simulate page 2 arriving with the exact same IDs — Twitch re-serving
    // the same channels under a fresh cursor. The GQL-layer cursor-no-advance
    // guard cannot detect this (the cursor advanced); the UI-layer dedup
    // absorbs everything; without the absorption guard the dropdown would
    // keep firing fetchMoreChannels indefinitely.
    await act(async () => {
      searchMockState.channelsData = { pages: [{ data: page1 }, { data: page1 }] };
      rerender(<UnifiedSearchInput initialValue="ninja" />);
    });

    const scrollable = document.querySelector("div.overflow-y-auto") as HTMLElement | null;
    expect(scrollable).not.toBeNull();
    if (!scrollable) return;

    Object.defineProperty(scrollable, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(scrollable, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(scrollable, "scrollTop", { value: 1700, configurable: true });
    fireEvent.scroll(scrollable);

    expect(searchMockState.channelsFetchNextPage).not.toHaveBeenCalled();
  });
});
