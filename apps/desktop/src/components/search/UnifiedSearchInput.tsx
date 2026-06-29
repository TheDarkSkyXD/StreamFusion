import { Link } from "@tanstack/react-router";
import React from "react";
import { LuHistory, LuLayoutGrid, LuSearch, LuSparkles, LuUser, LuX } from "react-icons/lu";

import type { UnifiedCategory, UnifiedChannel } from "@/backend/api/unified/platform-types";
import { StreamVerifiedBadge } from "@/components/stream/stream-verified-badge";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { useUnifiedCategoryLink } from "@/hooks/queries/useCategories";
import { useSearchCategories, useSearchChannels } from "@/hooks/queries/useSearch";
import { useDebounce } from "@/hooks/useDebounce";
import { type SearchHistoryScope, useSearchHistory } from "@/hooks/useSearchHistory";
import { cn, normalizeCategoryName, pickWinner } from "@/lib/utils";
import type { Platform } from "@/shared/auth-types";

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

// Hard cap on how many combined channel + category rows the dropdown will
// auto-fetch via infinite scroll. Past this, the bottom CTA routes to the
// full Search Results page so the dropdown stays a quick-glance affordance.
const DROPDOWN_RESULT_CAP = 100;

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
  const Wrapper = onSelectCategory ? "div" : Link;
  const linkProps = onSelectCategory
    ? {}
    : {
        to: "/categories/$platform/$categoryId",
        params: { platform: linkPlatform, categoryId: linkCategoryId },
        search: otherId ? { otherId } : {},
      };

  return (
    // @ts-expect-error - Link props vs div props complexity
    <Wrapper
      {...linkProps}
      onClick={(e: React.MouseEvent) => onClick(category, e)}
      className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--color-background-secondary)] transition-colors group cursor-pointer"
    >
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
    </Wrapper>
  );
}

function ChannelItem({
  channel,
  onClick,
  onSelectChannel,
  platform,
}: {
  channel: UnifiedChannel;
  onClick: (c: UnifiedChannel, e: React.MouseEvent) => void;
  onSelectChannel?: (channel: UnifiedChannel) => void;
  platform?: Platform;
}) {
  const Wrapper = onSelectChannel ? "div" : Link;
  const linkProps = onSelectChannel
    ? {}
    : {
        to: "/stream/$platform/$channel",
        params: { platform: channel.platform, channel: channel.username },
        search: { tab: "home" },
      };

  const avatarFallback = (
    <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center">
      <span className="text-xs font-bold text-white uppercase">
        {channel.displayName.slice(0, 1)}
      </span>
    </div>
  );

  const followerText = formatFollowerCount(channel.followerCount);
  const showPartnerBadge = channel.isPartner || channel.isVerified;

  return (
    // @ts-expect-error - Link props vs div props complexity
    <Wrapper
      {...linkProps}
      onClick={(e: React.MouseEvent) => onClick(channel, e)}
      className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--color-background-secondary)] transition-colors group cursor-pointer"
    >
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
    </Wrapper>
  );
}

export function UnifiedSearchInput({
  platform,
  onSelectChannel,
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
  const singleChannelQuery = useSearchChannels(
    splitPlatformSearch ? "" : debouncedQuery,
    platform,
    50
  );
  const twitchChannelQuery = useSearchChannels(
    splitPlatformSearch ? debouncedQuery : "",
    "twitch",
    25
  );
  const kickChannelQuery = useSearchChannels(splitPlatformSearch ? debouncedQuery : "", "kick", 25);
  const singleCategoryQuery = useSearchCategories(
    splitPlatformSearch ? "" : debouncedQuery,
    platform,
    20
  );
  const twitchCategoryQuery = useSearchCategories(
    splitPlatformSearch ? debouncedQuery : "",
    "twitch",
    10
  );
  const kickCategoryQuery = useSearchCategories(
    splitPlatformSearch ? debouncedQuery : "",
    "kick",
    10
  );

  const channelQueries = splitPlatformSearch
    ? [twitchChannelQuery, kickChannelQuery]
    : [singleChannelQuery];
  const categoryQueries = splitPlatformSearch
    ? [twitchCategoryQuery, kickCategoryQuery]
    : [singleCategoryQuery];

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

  // Dedup-absorption detector. Twitch can re-serve the same channels under
  // a fresh cursor on every LoadMore call, which the GQL-layer
  // cursor-no-advance guard cannot catch (returned cursor != input cursor).
  // When a fetched page adds zero net new unique IDs at the UI layer, the
  // dedup absorbed every row — treat that as end-of-list and stop calling
  // fetchNextPage. Cross-render state, reset when the query changes.
  const queryStateRef = React.useRef<{
    query: string;
    seenIds: Set<string>;
    lastRawCount: number;
    absorbed: boolean;
  }>({ query: "", seenIds: new Set(), lastRawCount: 0, absorbed: false });

  // useLayoutEffect (not useEffect) — must run before the absorption-
  // detection layout effect below in declaration order so the reset
  // clears state before the same render's data is processed.
  React.useLayoutEffect(() => {
    if (queryStateRef.current.query !== debouncedQuery) {
      queryStateRef.current = {
        query: debouncedQuery,
        seenIds: new Set(),
        lastRawCount: 0,
        absorbed: false,
      };
      // Also reset the in-flight scroll-handler latch. Otherwise an orphan
      // fetch from the old query (still pending) keeps the latch true and
      // silently blocks the first scroll-driven fetchNextPage on the new
      // query until the orphan's .finally fires.
      fetchInFlightRef.current.channels = false;
      fetchInFlightRef.current.categories = false;
    }
  }, [debouncedQuery]);

  // useLayoutEffect (not useEffect) is load-bearing here. A regular
  // useEffect runs AFTER paint, leaving a window between commit-finishes
  // and effect-runs during which the scroll handler can already fire and
  // read a stale `absorbed=false` for a page that should have been
  // detected as absorbed. useLayoutEffect runs synchronously after DOM
  // mutations but before paint and before any browser-queued scroll event
  // for this commit, closing the lag window.
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
      state.absorbed = true;
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

  // Split channels into exact matches and others, sort by live status
  const { topMatches, otherMatches } = React.useMemo(() => {
    if (!channels.length || !searchQuery) return { topMatches: [], otherMatches: [] };

    const normalizedQuery = searchQuery.toLowerCase().trim();
    const top: UnifiedChannel[] = [];
    const others: UnifiedChannel[] = [];
    const seenIds = new Set<string>();

    // Pre-sort channels to ensure we keep the "best" version when deduplicating
    // Priority: Live > Exact Match > Has Avatar
    const candidateChannels = liveOnlyChannels
      ? channels.filter((channel) => channel.isLive)
      : channels;

    const sortedChannels = [...candidateChannels].sort((a, b) => {
      // 1. Live status
      if (a.isLive && !b.isLive) return -1;
      if (!a.isLive && b.isLive) return 1;

      // 2. Exact match
      const aName = a.username?.toLowerCase() || "";
      const bName = b.username?.toLowerCase() || "";
      const aDisp = a.displayName?.toLowerCase() || "";
      const bDisp = b.displayName?.toLowerCase() || "";

      const aExact = aName === normalizedQuery || aDisp === normalizedQuery;
      const bExact = bName === normalizedQuery || bDisp === normalizedQuery;

      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      // 3. Has Avatar (prefer one with avatar)
      const aHasAvatar = !!a.avatarUrl;
      const bHasAvatar = !!b.avatarUrl;
      if (aHasAvatar && !bHasAvatar) return -1;
      if (!aHasAvatar && bHasAvatar) return 1;

      return 0;
    });

    sortedChannels.forEach((channel) => {
      // Deduplicate by Platform + DisplayName to catch visual duplicates
      // We use DisplayName because sometimes the backend might return slightly different usernames/slugs
      // for the same actual channel (e.g. ghost records from search API), resulting in visual duplicates.
      const uniqueKey = `${channel.platform}-${channel.displayName?.toLowerCase() || channel.username?.toLowerCase()}`;

      if (seenIds.has(uniqueKey)) return;
      seenIds.add(uniqueKey);

      const username = channel.username?.toLowerCase() || "";
      const displayName = channel.displayName?.toLowerCase() || "";
      const isExact = username === normalizedQuery || displayName === normalizedQuery;

      if (isExact) {
        top.push(channel);
      } else {
        others.push(channel);
      }
    });

    // Sort both arrays to show live channels first (redundant but ensures consistency)
    const sortByLive = (a: UnifiedChannel, b: UnifiedChannel) => {
      if (a.isLive && !b.isLive) return -1;
      if (!a.isLive && b.isLive) return 1;
      return 0;
    };

    top.sort(sortByLive);
    others.sort(sortByLive);

    return { topMatches: top, otherMatches: others };
  }, [channels, liveOnlyChannels, searchQuery]);

  // Apply the active tab to derived results. Streams are represented by live
  // channel matches in the existing search API.
  const shouldShowLiveOnly = liveOnlyChannels || (showSearchTabs && activeTab === "streams");
  const filteredTopMatches = shouldShowLiveOnly ? topMatches.filter((c) => c.isLive) : topMatches;
  const filteredOtherMatches = shouldShowLiveOnly
    ? otherMatches.filter((c) => c.isLive)
    : otherMatches;
  const showChannelResults = !showSearchTabs || activeTab === "channels" || activeTab === "streams";
  const showCategoryResults = showCategories && (!showSearchTabs || activeTab === "categories");

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

  // capReached uses the raw pre-filter row count (channels.length +
  // categories.length), not the post-filter visible count. Flipping the
  // platform or live-only filter can drop the visible row count below 100,
  // but the cap stays in force — otherwise auto-fetch would resume past
  // the intended ceiling on every filter change. Infinite-query data only
  // grows within a single query, so the current render's raw count is also
  // the peak.
  const rawRowCount = showChannelResults ? channels.length : dedupedCategories.length;
  const capReached = rawRowCount >= DROPDOWN_RESULT_CAP;
  const hasMoreResults =
    (showChannelResults && channelsHasNextPage) || (showCategoryResults && categoriesHasNextPage);
  const capReachedWithMore = capReached && hasMoreResults;

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
            "w-full h-9 pl-10 pr-9 rounded-full bg-neutral-800 border border-neutral-700 text-sm font-bold text-white placeholder:text-neutral-300 placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-white/50 focus:border-white transition-all",
            inputClassName
          )}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
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
            // Stop auto-fetching once the dropdown has rendered the cap, OR
            // once we've detected dedup-absorption (Twitch re-serving the
            // same channels under a fresh cursor). `absorbed` is set inside
            // a useEffect, so we read it from the ref at event time — a
            // closure capture would see the pre-effect value from the
            // render that built this handler.
            if (capReached || queryStateRef.current.absorbed) return;
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
                  className="group flex h-14 cursor-pointer items-center justify-between gap-4 px-4 py-2 text-left transition-colors hover:bg-[var(--color-background-secondary)] lg:px-6"
                  onClick={() => executeSearch(term)}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-4 text-white/70 transition-colors group-hover:text-white">
                    <LuHistory size={20} strokeWidth={2.5} className="shrink-0" />
                    <span className="truncate text-base font-semibold text-white group-hover:text-white">
                      {term}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSearch(term);
                    }}
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
                {capReachedWithMore
                  ? `Show more results for "${searchQuery}"`
                  : `See all results for "${searchQuery}"`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
