import { act, fireEvent } from "@testing-library/react";
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
  categoriesData: { pages: [] as { data: unknown[] }[] },
  categoriesHasNextPage: false,
  categoriesFetchNextPage: vi.fn(),
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

vi.mock("@/hooks/queries/useSearch", () => ({
  useSearchChannels: () => ({
    data: searchMockState.channelsData,
    isLoading: false,
    fetchNextPage: searchMockState.channelsFetchNextPage,
    hasNextPage: searchMockState.channelsHasNextPage,
    isFetchingNextPage: false,
  }),
  useSearchCategories: () => ({
    data: searchMockState.categoriesData,
    isLoading: false,
    fetchNextPage: searchMockState.categoriesFetchNextPage,
    hasNextPage: searchMockState.categoriesHasNextPage,
    isFetchingNextPage: false,
  }),
}));

vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: <T,>(v: T) => v,
}));

vi.mock("@/hooks/useSearchHistory", () => ({
  useSearchHistory: (scope: "channels" | "categories" | "streams" = "channels") => ({
    history: historyMockState.historyByScope[scope],
    historyByScope: historyMockState.historyByScope,
    addSearch: historyMockState.addSearch,
    removeSearch: historyMockState.removeSearch,
    clearHistory: historyMockState.clearHistory,
  }),
}));

vi.mock("@/hooks/queries/useCategories", () => ({
  useUnifiedCategoryLink: () => ({
    linkPlatform: "twitch",
    linkCategoryId: "cat-1",
    otherId: undefined,
  }),
}));

vi.mock("@/components/ui/proxied-image", () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

import { UnifiedSearchInput } from "@/components/search/UnifiedSearchInput";

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
  searchMockState.categoriesData = { pages: [] };
  searchMockState.categoriesHasNextPage = false;
  searchMockState.categoriesFetchNextPage = vi.fn(() => Promise.resolve());
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
// Guards: 100-cap pagination class — when combined results hit the cap AND more remain, footer flips to "Show more"; the auto-fetch on near-bottom scroll halts (otherwise the dropdown would re-fetch indefinitely)
// Guards: dedup absorption — when a page arrives with zero net new IDs (Twitch re-serves under a fresh cursor), the dropdown must not auto-fetch the next page. Without this the dropdown loops forever
describe("UnifiedSearchInput", () => {
  beforeEach(() => {
    resetSearchMock();
    resetHistoryMock();
  });

  it("renders an input with the placeholder", () => {
    renderWithProviders(<UnifiedSearchInput placeholder="Search the world" />);
    const input = screen.getByPlaceholderText("Search the world");
    expect(input).toBeInTheDocument();
    expect(input).toHaveClass("bg-neutral-800", "border-neutral-700", "text-white");
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

describe("UnifiedSearchInput — dropdown 100-cap and Show more CTA", () => {
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

  it('renders "See all results for X" when result count is below the 100-cap', () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(30) }] };
    searchMockState.channelsHasNextPage = true;
    openDropdown("ninja");
    expect(screen.getByText('See all results for "ninja"')).toBeInTheDocument();
    expect(screen.queryByText('Show more results for "ninja"')).not.toBeInTheDocument();
  });

  it("renders channel suggestions and the results CTA for a one-letter query", () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(3, "a") }] };
    openDropdown("A");
    expect(screen.getByText("A0")).toBeInTheDocument();
    expect(screen.getByText('See all results for "A"')).toBeInTheDocument();
  });

  it('flips footer to "Show more results for X" when combined results hit the cap AND more remain', () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(100) }] };
    searchMockState.channelsHasNextPage = true;
    openDropdown("ninja");
    expect(screen.getByText('Show more results for "ninja"')).toBeInTheDocument();
    expect(screen.queryByText('See all results for "ninja"')).not.toBeInTheDocument();
  });

  it('keeps the "See all results" copy when cap is reached BUT no more results remain', () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(100) }] };
    searchMockState.channelsHasNextPage = false;
    openDropdown("ninja");
    expect(screen.getByText('See all results for "ninja"')).toBeInTheDocument();
    expect(screen.queryByText('Show more results for "ninja"')).not.toBeInTheDocument();
  });

  it("routes the footer click through onSearch — same destination whether capped or not", () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(100) }] };
    searchMockState.channelsHasNextPage = true;
    const { onSearch } = openDropdown("ninja");
    fireEvent.click(screen.getByText('Show more results for "ninja"'));
    expect(onSearch).toHaveBeenCalledWith("ninja");
  });

  it("does NOT trigger fetchNextPage on near-bottom scroll when cap is reached", () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(100) }] };
    searchMockState.channelsHasNextPage = true;
    openDropdown("ninja");

    const scrollable = document.querySelector("div.overflow-y-auto") as HTMLElement | null;
    expect(scrollable).not.toBeNull();
    if (!scrollable) return;

    Object.defineProperty(scrollable, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(scrollable, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(scrollable, "scrollTop", { value: 1700, configurable: true });
    fireEvent.scroll(scrollable);

    expect(searchMockState.channelsFetchNextPage).not.toHaveBeenCalled();
    expect(searchMockState.categoriesFetchNextPage).not.toHaveBeenCalled();
  });

  it("DOES trigger fetchNextPage on near-bottom scroll when below the cap and more pages exist", () => {
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
