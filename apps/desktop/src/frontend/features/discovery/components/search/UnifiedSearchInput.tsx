import { Link } from "@tanstack/react-router";
import React from "react";
import { LuHistory, LuLayoutGrid, LuSearch, LuSparkles, LuStar, LuUser, LuX } from "react-icons/lu";

import type { UnifiedCategory, UnifiedChannel } from "@shared/platform-types";
import { StreamVerifiedBadge } from "@/features/discovery/components/stream/stream-verified-badge";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { useUnifiedCategoryLink } from "@/features/discovery/data/queries/useCategories";
import {
  useSearchCategories,
  useSearchChannels,
} from "@/features/discovery/data/queries/useSearch";
import { useDebounce } from "@/hooks/useDebounce";
import {
  type SearchHistoryScope,
  useSearchHistory,
} from "@/features/discovery/data/useSearchHistory";
import { cn, normalizeCategoryName, pickWinner } from "@/lib/utils";
import {
  isExactChannelSearchMatch,
  rankSearchChannels,
} from "@/features/discovery/utils/search/channel-search-contract";
import { preloadSearchPage } from "@/features/discovery/routes/search-page";
import type { Platform } from "@shared/auth-types";

interface UnifiedSearchInputProps {
  /**
   * Optional platform to filter search results.
   */
  platform?: Platform;
  /**
   * Callback when a channel is selected.
   * If provided, prevents default navigation for channels.
   */
  onSelectChannel?: (channel: UnifiedChannel) => void;
  /** Returns whether a channel is saved as a Multi View favorite. */
  isChannelFavorite?: (channel: UnifiedChannel) => boolean;
  /** Optional separate action rendered beside channel suggestions. */
  onToggleChannelFavorite?: (channel: UnifiedChannel) => void;
  /**
   * Callback when a category is selected.
   * If provided, prevents default navigation for categories.
   */
  onSelectCategory?: (category: UnifiedCategory) => void;
  /**
   * Callback when search is executed (Enter key or history item).
   */
  onSearch?: (term: string) => void;
  /**
   * Whether to show category suggestions.
   * @default true
   */
  showCategories?: boolean;
  /**
   * Whether to show search type tabs in the dropdown.
   * Defaults to the same value as showCategories so channel-only pickers stay compact.
   */
  showSearchTabs?: boolean;
  /**
   * Whether channel suggestions should include only currently live channels.
   * Useful for stream pickers where offline channels cannot be added.
   * @default false
   */
  liveOnlyChannels?: boolean;
  /**
   * Placeholder text for the input.
   */
  placeholder?: string;
  /**
   * Wrapper class name.
   */
  className?: string;
  /**
   * Input element class name.
   */
  inputClassName?: string;
  /**
   * Initial value for the input.
   */
  initialValue?: string;
  /**
   * Ref for the input element.
   */
  inputRef?: React.RefObject<HTMLInputElement>;
  /**
   * Auto focus the input on mount.
   */
  autoFocus?: boolean;
}

type SearchTab = SearchHistoryScope;

const SEARCH_TABS: { id: SearchTab; label: string }[] = [
  { id: "channels", label: "Channels" },
  { id: "categories", label: "Categories" },
  { id: "streams", label: "Streams" },
];

const ONE_LETTER_CHANNEL_TARGET = 5;

function formatFollowerCount(count: number | undefined): string | null {
  if (count === undefined || count === null) return null;
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1).replace(/\.0$/, "")}M followers`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}K followers`;
  }
  return `${count} followers`;
}

// Helper to render category items. Extracted so each call can invoke
// useUnifiedCategoryLink — that resolves the canonical cross-platform target
// so a click here lands on the same merged Categories page as the grid does.
function CategoryItem({
  category,
  onClick,
  onSelectCategory,
}: {
  category: UnifiedCategory;
  onClick: (c: UnifiedCategory, e: React.MouseEvent) => void;
  onSelectCategory?: (category: UnifiedCategory) => void;
}) {
  const { linkPlatform, linkCategoryId, otherId } = useUnifiedCategoryLink(
    category.platform,
    category.id,
    category.name
  );
  const className =
    "group flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-[var(--color-background-secondary)]";
  const style = { contentVisibility: "auto", containIntrinsicSize: "48px" } as const;
  const content = (
    <>
      {category.boxArtUrl ? (
        <img
          src={category.boxArtUrl}
          alt={category.name}
          className="w-6 h-8 rounded object-cover"
        />
      ) : (
        <div className="w-6 h-8 rounded bg-zinc-700 flex items-center justify-center">
          <LuLayoutGrid size={14} className="text-white/50" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm text-[var(--color-foreground)] group-hover:text-[var(--color-storm-primary)] truncate">
          {category.name}
        </p>
      </div>
    </>
  );

  if (onSelectCategory) {
    return (
      <button
        type="button"
        onClick={(event) => onClick(category, event)}
        className={className}
        style={style}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      to="/categories/$platform/$categoryId"
      params={{ platform: linkPlatform, categoryId: linkCategoryId }}
      search={otherId ? { otherId } : {}}
      onClick={(event) => onClick(category, event)}
      className={className}
      style={style}
    >
      {content}
    </Link>
  );
}

function ChannelItem({
  channel,
  onClick,
  onSelectChannel,
  isFavorite,
  onToggleFavorite,
  platform,
}: {
  channel: UnifiedChannel;
  onClick: (c: UnifiedChannel, e: React.MouseEvent) => void;
  onSelectChannel?: (channel: UnifiedChannel) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (channel: UnifiedChannel) => void;
  platform?: Platform;
}) {
  const avatarFallback = (
    <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center">
      <span className="text-xs font-bold text-white uppercase">
        {channel.displayName.slice(0, 1)}
      </span>
    </div>
  );

  const followerText = formatFollowerCount(channel.followerCount);
  const showPartnerBadge = channel.isPartner || channel.isVerified;
  const channelContent = (
    <>
      <div className="relative">
        {channel.avatarUrl ? (
          <ProxiedImage
            src={channel.avatarUrl}
            alt={channel.displayName}
            className="w-8 h-8 rounded-full object-cover"
            fallback={avatarFallback}
          />
        ) : (
          avatarFallback
        )}
        {channel.isLive && (
          <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-[#0F0F12]" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="min-w-0 truncate font-bold text-sm text-[var(--color-foreground)] group-hover:text-[var(--color-storm-primary)]">
            {channel.displayName}
          </p>
          {showPartnerBadge && <StreamVerifiedBadge platform={channel.platform} />}
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          {!platform && <span className="capitalize">{channel.platform}</span>}
          {followerText && <span>{followerText}</span>}
          {channel.isLive && <span className="text-red-500 font-bold">• LIVE</span>}
        </div>
      </div>
    </>
  );
  const interactiveClassName =
    "group flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-4 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)]";

  return (
    <div
      className="flex items-stretch rounded-lg transition-colors hover:bg-[var(--color-background-secondary)]"
      style={{ contentVisibility: "auto", containIntrinsicSize: "48px" }}
    >
      {onSelectChannel ? (
        <button
          type="button"
          onClick={(event) => onClick(channel, event)}
          className={interactiveClassName}
        >
          {channelContent}
        </button>
      ) : (
        <Link
          to="/stream/$platform/$channel"
          params={{ platform: channel.platform, channel: channel.username }}
          search={{ tab: "home" }}
          onClick={(event) => onClick(channel, event)}
          className={interactiveClassName}
        >
          {channelContent}
        </Link>
      )}
      {onToggleFavorite && (
        <button
          type="button"
          aria-pressed={isFavorite}
          aria-label={`${isFavorite ? "Remove" : "Add"} ${channel.displayName} ${isFavorite ? "from" : "to"} favorites`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleFavorite(channel);
          }}
          className="m-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--color-foreground-secondary)] transition-colors hover:bg-[var(--color-background-tertiary)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        >
          <LuStar className={cn("h-4 w-4", isFavorite && "fill-current text-white")} />
        </button>
      )}
    </div>
  );
}

export function UnifiedSearchInput({
  platform,
  onSelectChannel,
  isChannelFavorite,
  onToggleChannelFavorite,
  onSelectCategory,
  onSearch,
  showCategories = true,
  showSearchTabs = showCategories,
  liveOnlyChannels = false,
  placeholder = "Search streams, channels, categories...",
  className,
  inputClassName,
  initialValue = "",
  inputRef: propInputRef,
  autoFocus,
}: UnifiedSearchInputProps) {
  const [searchQuery, setSearchQuery] = React.useState(initialValue);
  const [isFocused, setIsFocused] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<SearchTab>("channels");
  const internalInputRef = React.useRef<HTMLInputElement>(null);
  const inputRef = propInputRef || internalInputRef;
  const containerRef = React.useRef<HTMLDivElement>(null);

  const visibleSearchTabs = React.useMemo(
    () =>
      showSearchTabs
        ? SEARCH_TABS.filter((tab) => showCategories || tab.id !== "categories")
        : SEARCH_TABS.filter((tab) => tab.id === "channels"),
    [showCategories, showSearchTabs]
  );
  const { history, addSearch, removeSearch } = useSearchHistory(activeTab);
  const debouncedQuery = useDebounce(searchQuery, 250);

  const shouldFetch = debouncedQuery.trim().length > 0;
  const showChannelResults = !showSearchTabs || activeTab === "channels" || activeTab === "streams";
  const showCategoryResults = showCategories && (!showSearchTabs || activeTab === "categories");
  const channelQuery = showChannelResults ? debouncedQuery : "";

  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Synchronous in-flight latch for the near-bottom scroll handler. Under
  // fast scroll (touchpad inertia, mouse wheel), the browser can fire several
  // scroll events in the same task tick before React commits the next render
  // that flips channelsFetchingNextPage / categoriesFetchingNextPage to true.
  // Without this latch, all of those events read the stale `false` and race
  // to call fetchMoreChannels/Categories. React Query's internal fetch
  // dedupe currently absorbs the duplicate calls, but the !fetchingNextPage
  // gate in the handler is doing less than it appears; this latch makes the
  // mutual exclusion observable at the event-time scope.
  const fetchInFlightRef = React.useRef<{ channels: boolean; categories: boolean }>({
    channels: false,
    categories: false,
  });

  const splitPlatformSearch = !platform;
  const splitChannelLimit = channelQuery.trim().length === 1 ? 50 : 25;
  const singleChannelQuery = useSearchChannels(
    splitPlatformSearch ? "" : channelQuery,
    platform,
    50,
    liveOnlyChannels
  );
  const twitchChannelQuery = useSearchChannels(
    splitPlatformSearch ? channelQuery : "",
    "twitch",
    splitChannelLimit,
    liveOnlyChannels
  );
  const kickChannelQuery = useSearchChannels(
    splitPlatformSearch ? channelQuery : "",
    "kick",
    splitChannelLimit,
    liveOnlyChannels
  );
  const singleCategoryQuery = useSearchCategories(
    splitPlatformSearch ? "" : debouncedQuery,
    platform,
    20,
    showCategoryResults
  );
  const twitchCategoryQuery = useSearchCategories(
    splitPlatformSearch ? debouncedQuery : "",
    "twitch",
    10,
    showCategoryResults
  );
  const kickCategoryQuery = useSearchCategories(
    splitPlatformSearch ? debouncedQuery : "",
    "kick",
    10,
    showCategoryResults
  );

  const channelQueries = React.useMemo(
    () => (splitPlatformSearch ? [twitchChannelQuery, kickChannelQuery] : [singleChannelQuery]),
    [kickChannelQuery, singleChannelQuery, splitPlatformSearch, twitchChannelQuery]
  );
  const categoryQueries = React.useMemo(
    () => (splitPlatformSearch ? [twitchCategoryQuery, kickCategoryQuery] : [singleCategoryQuery]),
    [kickCategoryQuery, singleCategoryQuery, splitPlatformSearch, twitchCategoryQuery]
  );

  const channelsLoading = channelQueries.some((query) => query.isLoading);
  const categoriesLoading = categoryQueries.some((query) => query.isLoading);
  const channelsHasNextPage = channelQueries.some((query) => query.hasNextPage);
  const categoriesHasNextPage = categoryQueries.some((query) => query.hasNextPage);
  const channelsFetchingNextPage = channelQueries.some((query) => query.isFetchingNextPage);
  const categoriesFetchingNextPage = categoryQueries.some((query) => query.isFetchingNextPage);

  const fetchMoreChannels = React.useCallback(
    () =>
      Promise.all(
        channelQueries
          .filter((query) => query.hasNextPage && !query.isFetchingNextPage)
          .map((query) => query.fetchNextPage())
      ),
    [channelQueries]
  );
  const fetchMoreCategories = React.useCallback(
    () =>
      Promise.all(
        categoryQueries
          .filter((query) => query.hasNextPage && !query.isFetchingNextPage)
          .map((query) => query.fetchNextPage())
      ),
    [categoryQueries]
  );

  // Flatten all pages into single arrays
  const channels = React.useMemo(
    () => channelQueries.flatMap((query) => query.data?.pages.flatMap((p) => p.data) ?? []),
    [channelQueries]
  );
  const categories = React.useMemo(
    () => categoryQueries.flatMap((query) => query.data?.pages.flatMap((p) => p.data) ?? []),
    [categoryQueries]
  );

  const queryStateRef = React.useRef<{
    query: string;
    seenIds: Set<string>;
    lastRawCount: number;
    paginationExhaustedByDuplicatePage: boolean;
  }>({
    query: "",
    seenIds: new Set(),
    lastRawCount: 0,
    paginationExhaustedByDuplicatePage: false,
  });

  React.useLayoutEffect(() => {
    if (queryStateRef.current.query !== debouncedQuery) {
      queryStateRef.current = {
        query: debouncedQuery,
        seenIds: new Set(),
        lastRawCount: 0,
        paginationExhaustedByDuplicatePage: false,
      };
      fetchInFlightRef.current.channels = false;
      fetchInFlightRef.current.categories = false;
    }
  }, [debouncedQuery]);

  React.useLayoutEffect(() => {
    const state = queryStateRef.current;
    if (state.query !== debouncedQuery) return;

    const rawCount = channels.length + categories.length;
    let newCount = 0;
    for (const c of channels) {
      const key = `ch-${c.platform}-${c.id}`;
      if (!state.seenIds.has(key)) {
        state.seenIds.add(key);
        newCount++;
      }
    }
    for (const cat of categories) {
      const key = `cat-${cat.platform}-${cat.id}`;
      if (!state.seenIds.has(key)) {
        state.seenIds.add(key);
        newCount++;
      }
    }

    // Absorption fires when a new page arrived (raw count grew past the
    // last-known count) but added zero net new uniques. Initial mount sees
    // rawCount > 0 with newCount === rawCount (everything new), so this
    // correctly doesn't fire on first data arrival.
    if (rawCount > state.lastRawCount && newCount === 0) {
      state.paginationExhaustedByDuplicatePage = true;
    }
    state.lastRawCount = rawCount;
  }, [channels, categories, debouncedQuery]);

  // Categories are universal across platforms — collapse cross-platform duplicates
  // by normalized name so "Just Chatting" doesn't appear twice. The link target is
  // canonical regardless of which side we keep (useUnifiedCategoryLink resolves it).
  const dedupedCategories = React.useMemo(() => {
    if (!categories.length) return [];
    const byKey = new Map<string, UnifiedCategory>();
    for (const category of categories) {
      const key = normalizeCategoryName(category.name);
      const existing = byKey.get(key);
      if (!existing || category.platform === pickWinner(key)) {
        byKey.set(key, category);
      }
    }
    return Array.from(byKey.values());
  }, [categories]);

  // Filter history based on query and platform?
  // History currently stores just strings. We can't easily filter by platform unless we store platform in history.
  // For now, we'll just filter by query string.
  const filteredHistory = React.useMemo(() => {
    if (!searchQuery) return history;
    const normalizedQuery = searchQuery.toLowerCase();
    return history.filter((item) => item.toLowerCase().includes(normalizedQuery));
  }, [searchQuery, history]);

  const { topMatches, otherMatches } = React.useMemo(() => {
    if (!channels.length || !searchQuery) return { topMatches: [], otherMatches: [] };

    const candidateChannels = liveOnlyChannels
      ? channels.filter((channel) => channel.isLive)
      : channels;
    const rankedChannels = rankSearchChannels(candidateChannels, searchQuery);
    const topMatches: UnifiedChannel[] = [];
    const otherMatches: UnifiedChannel[] = [];
    for (const channel of rankedChannels) {
      if (isExactChannelSearchMatch(channel, searchQuery)) topMatches.push(channel);
      else otherMatches.push(channel);
    }
    return { topMatches, otherMatches };
  }, [channels, liveOnlyChannels, searchQuery]);

  // Apply the active tab to derived results. Streams are represented by live
  // channel matches in the existing search API.
  const shouldShowLiveOnly = liveOnlyChannels || (showSearchTabs && activeTab === "streams");
  const filteredTopMatches = shouldShowLiveOnly ? topMatches.filter((c) => c.isLive) : topMatches;
  const filteredOtherMatches = shouldShowLiveOnly
    ? otherMatches.filter((c) => c.isLive)
    : otherMatches;

  React.useEffect(() => {
    const queryState = queryStateRef.current;
    if (
      !isFocused ||
      activeTab !== "channels" ||
      channelQuery.trim().length !== 1 ||
      filteredOtherMatches.length >= ONE_LETTER_CHANNEL_TARGET ||
      channelsLoading ||
      channelsFetchingNextPage ||
      !channelsHasNextPage ||
      queryState.paginationExhaustedByDuplicatePage ||
      fetchInFlightRef.current.channels
    ) {
      return;
    }

    fetchInFlightRef.current.channels = true;
    void fetchMoreChannels().finally(() => {
      fetchInFlightRef.current.channels = false;
    });
  }, [
    activeTab,
    channelQuery,
    channels.length,
    channelsFetchingNextPage,
    channelsHasNextPage,
    channelsLoading,
    fetchMoreChannels,
    filteredOtherMatches.length,
    isFocused,
  ]);

  // Hide suggestions when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsFocused(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  React.useEffect(() => {
    if ((!showCategories && activeTab === "categories") || !showSearchTabs) {
      setActiveTab("channels");
    }
  }, [activeTab, showCategories, showSearchTabs]);

  const executeSearch = (term: string) => {
    if (!term.trim()) return;
    addSearch(term, activeTab);
    if (onSearch) {
      onSearch(term);
    }
    setIsFocused(false);
    setSearchQuery(term);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      executeSearch(searchQuery);
    }
  };

  const handleClear = () => {
    setSearchQuery("");
    inputRef.current?.focus();
  };

  const handleChannelClick = (channel: UnifiedChannel, e?: React.MouseEvent) => {
    addSearch(channel.displayName, activeTab === "streams" ? "streams" : "channels");
    setIsFocused(false);
    setSearchQuery(channel.displayName); // Update input with selected name

    if (onSelectChannel) {
      e?.preventDefault(); // Prevent navigation if we're just selecting
      onSelectChannel(channel);
    }
  };

  const handleCategoryClick = (category: UnifiedCategory, e?: React.MouseEvent) => {
    addSearch(category.name, "categories");
    setIsFocused(false);
    setSearchQuery("");

    if (onSelectCategory) {
      e?.preventDefault();
      onSelectCategory(category);
    }
  };

  const activeResultsCount = showChannelResults
    ? filteredTopMatches.length + filteredOtherMatches.length
    : dedupedCategories.length;
  const activeLoading = showChannelResults ? channelsLoading : categoriesLoading;
  const hasResults = shouldFetch && activeResultsCount > 0;
  const showHistory = isFocused && !searchQuery && history.length > 0;
  const showSuggestions =
    isFocused && searchQuery.length > 0 && (hasResults || activeLoading || Boolean(onSearch));
  const showDropdown =
    isFocused &&
    (showHistory || searchQuery.length > 0 || (showSearchTabs && visibleSearchTabs.length > 1));

  return (
    <div ref={containerRef} className={cn("relative w-full z-50", className)}>
      <div className="relative">
        <div
          className={cn(
            "absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none transition-colors",
            isFocused ? "text-white" : "text-[var(--color-foreground-muted)]"
          )}
        >
          <LuSearch size={16} />
        </div>
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          className={cn(
            "w-full h-9 pl-10 pr-9 rounded-full bg-neutral-800 border border-neutral-700 text-sm font-bold text-white placeholder:text-neutral-300 placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-white/50 focus:border-white transition-[border-color,box-shadow]",
            inputClassName
          )}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setIsFocused(true);
            void preloadSearchPage();
          }}
          // Prevent default autocomplete
          autoComplete="off"
        />

        {/* Right-side clear action */}
        <div className="absolute right-2 top-0 bottom-0 flex items-center gap-0.5">
          {searchQuery && (
            <button
              onClick={handleClear}
              className={cn(
                "p-1 transition-colors hover:text-white",
                isFocused ? "text-white" : "text-[var(--color-foreground-muted)]"
              )}
              title="Clear search"
              type="button"
            >
              <LuX size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Suggestions Dropdown */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          onScroll={(e) => {
            if (queryStateRef.current.paginationExhaustedByDuplicatePage) return;
            const el = e.currentTarget;
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
            if (!nearBottom) return;

            const latch = fetchInFlightRef.current;
            if (
              showChannelResults &&
              channelsHasNextPage &&
              !channelsFetchingNextPage &&
              !latch.channels
            ) {
              latch.channels = true;
              // try/catch + Promise.resolve guards two failure modes:
              // (1) the caller throws synchronously — without try/catch the
              //     throw escapes before .finally is attached and the latch
              //     stays true forever; (2) the caller returns a non-Promise
              //     value — Promise.resolve normalizes it so .finally always
              //     fires asynchronously.
              try {
                Promise.resolve(fetchMoreChannels()).finally(() => {
                  latch.channels = false;
                });
              } catch {
                latch.channels = false;
              }
            }
            if (
              showCategoryResults &&
              categoriesHasNextPage &&
              !categoriesFetchingNextPage &&
              !latch.categories
            ) {
              latch.categories = true;
              try {
                Promise.resolve(fetchMoreCategories()).finally(() => {
                  latch.categories = false;
                });
              } catch {
                latch.categories = false;
              }
            }
          }}
          className="absolute top-full left-0 right-0 mt-2 bg-[#0F0F12] border border-[var(--color-border)] rounded-xl overflow-hidden shadow-2xl animate-in fade-in slide-in-from-top-1 duration-200 flex flex-col max-h-[60vh] overflow-y-auto"
        >
          {showSearchTabs && (
            <div
              className="sticky top-0 z-10 grid gap-1 border-b border-[var(--color-border)] bg-[#0F0F12] p-1.5"
              style={{
                gridTemplateColumns: `repeat(${visibleSearchTabs.length}, minmax(0, 1fr))`,
              }}
              role="tablist"
              aria-label="Search type"
            >
              {visibleSearchTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "h-8 rounded-lg px-2 text-xs font-bold transition-colors",
                    activeTab === tab.id
                      ? "bg-[var(--color-background-tertiary)] text-white"
                      : "text-[var(--color-foreground-muted)] hover:bg-[var(--color-background-secondary)] hover:text-white"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* SEARCH HISTORY */}
          {showHistory && (
            <div className="py-2">
              {filteredHistory.map((term) => (
                <div
                  key={term}
                  className="group flex h-14 items-center justify-between gap-1 px-2 py-2 transition-colors hover:bg-[var(--color-background-secondary)] lg:px-4"
                >
                  <button
                    type="button"
                    onClick={() => executeSearch(term)}
                    className="flex h-full min-w-0 flex-1 items-center gap-4 rounded px-2 text-left text-white/70 transition-colors group-hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                  >
                    <LuHistory size={20} strokeWidth={2.5} className="shrink-0" />
                    <span className="truncate text-base font-semibold text-white group-hover:text-white">
                      {term}
                    </span>
                  </button>
                  <button
                    onClick={() => removeSearch(term)}
                    className="flex size-8 shrink-0 items-center justify-center rounded text-white/70 transition-colors hover:bg-[var(--color-background-tertiary)] hover:text-white"
                    title="Remove from history"
                    aria-label={`Remove "${term}" from history`}
                    type="button"
                  >
                    <LuX size={20} strokeWidth={2.5} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* BEST MATCHES */}
          {showChannelResults && filteredTopMatches.length > 0 && (
            <div className={cn("py-2", showHistory && "border-t border-[var(--color-border)]")}>
              <h3 className="px-4 py-1.5 text-xs font-bold text-[var(--color-storm-primary)] uppercase tracking-wider flex items-center gap-2">
                <LuSparkles size={12} /> Best Match
              </h3>
              {filteredTopMatches.map((channel) => (
                <ChannelItem
                  key={`${channel.platform}-${channel.id}`}
                  channel={channel}
                  onClick={handleChannelClick}
                  onSelectChannel={onSelectChannel}
                  isFavorite={isChannelFavorite?.(channel)}
                  onToggleFavorite={onToggleChannelFavorite}
                  platform={platform}
                />
              ))}
            </div>
          )}

          {/* OTHER CHANNELS SUGGESTIONS */}
          {showChannelResults && (filteredOtherMatches.length > 0 || channelsLoading) && (
            <div
              className={cn(
                "py-2",
                (showHistory || filteredTopMatches.length > 0) &&
                  "border-t border-[var(--color-border)]"
              )}
            >
              <h3 className="px-4 py-1.5 text-xs font-bold text-[var(--color-foreground-muted)] uppercase tracking-wider flex items-center gap-2">
                <LuUser size={12} /> {activeTab === "streams" ? "Streams" : "Channels"}
              </h3>
              {filteredOtherMatches.map((channel) => (
                <ChannelItem
                  key={`${channel.platform}-${channel.id}`}
                  channel={channel}
                  onClick={handleChannelClick}
                  onSelectChannel={onSelectChannel}
                  isFavorite={isChannelFavorite?.(channel)}
                  onToggleFavorite={onToggleChannelFavorite}
                  platform={platform}
                />
              ))}
              {/* Initial loading skeletons */}
              {channelsLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2 animate-pulse">
                    <div className="w-8 h-8 rounded-full bg-zinc-800 shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-zinc-800 rounded w-28" />
                      <div className="h-2.5 bg-zinc-800 rounded w-20" />
                    </div>
                  </div>
                ))}
              {/* Load-more skeletons */}
              {channelsFetchingNextPage &&
                Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={`next-${i}`}
                    className="flex items-center gap-3 px-4 py-2 animate-pulse"
                  >
                    <div className="w-8 h-8 rounded-full bg-zinc-800 shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-zinc-800 rounded w-28" />
                      <div className="h-2.5 bg-zinc-800 rounded w-20" />
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* CATEGORIES SUGGESTIONS */}
          {showCategoryResults && (dedupedCategories.length > 0 || categoriesLoading) && (
            <div className={cn("py-2 border-t border-[var(--color-border)]")}>
              <h3 className="px-4 py-1.5 text-xs font-bold text-[var(--color-foreground-muted)] uppercase tracking-wider flex items-center gap-2">
                <LuLayoutGrid size={12} /> Categories
              </h3>
              {dedupedCategories.map((category) => (
                <CategoryItem
                  key={`${category.platform}-${category.id}`}
                  category={category}
                  onClick={handleCategoryClick}
                  onSelectCategory={onSelectCategory}
                />
              ))}
              {/* Initial loading skeletons */}
              {categoriesLoading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2 animate-pulse">
                    <div className="w-6 h-8 rounded bg-zinc-800 shrink-0" />
                    <div className="h-3 bg-zinc-800 rounded w-24" />
                  </div>
                ))}
              {/* Load-more skeletons */}
              {categoriesFetchingNextPage &&
                Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={`next-${i}`}
                    className="flex items-center gap-3 px-4 py-2 animate-pulse"
                  >
                    <div className="w-6 h-8 rounded bg-zinc-800 shrink-0" />
                    <div className="h-3 bg-zinc-800 rounded w-24" />
                  </div>
                ))}
            </div>
          )}

          {onSearch && searchQuery.length > 0 && (
            <div className="p-2 border-t border-[var(--color-border)] bg-[var(--color-background-secondary)]/50">
              <button
                onClick={() => executeSearch(searchQuery)}
                className="w-full py-2 text-sm font-bold text-[var(--color-storm-primary)] hover:underline flex items-center justify-center gap-1"
              >
                <LuSearch size={14} />
                {`See all results for "${searchQuery}"`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
