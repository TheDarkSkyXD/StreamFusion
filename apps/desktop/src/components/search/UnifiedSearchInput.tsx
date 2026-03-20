import { Link } from "@tanstack/react-router";
import React from "react";
import { LuClock, LuLayoutGrid, LuSearch, LuSparkles, LuUser, LuX } from "react-icons/lu";

import type { UnifiedCategory, UnifiedChannel } from "@/backend/api/unified/platform-types";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { useSearchCategories, useSearchChannels } from "@/hooks/queries/useSearch";
import { useDebounce } from "@/hooks/useDebounce";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { cn } from "@/lib/utils";
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

export function UnifiedSearchInput({
  platform,
  onSelectChannel,
  onSelectCategory,
  onSearch,
  showCategories = true,
  placeholder = "Search streams, channels, categories...",
  className,
  inputClassName,
  initialValue = "",
  inputRef: propInputRef,
  autoFocus,
}: UnifiedSearchInputProps) {
  const [searchQuery, setSearchQuery] = React.useState(initialValue);
  const [isFocused, setIsFocused] = React.useState(false);
  const internalInputRef = React.useRef<HTMLInputElement>(null);
  const inputRef = propInputRef || internalInputRef;
  const containerRef = React.useRef<HTMLDivElement>(null);

  const { history, addSearch, removeSearch } = useSearchHistory();
  const debouncedQuery = useDebounce(searchQuery, 300);

  const shouldFetch = debouncedQuery.length > 0;

  // Pass platform to hooks - higher limit to show results from both platforms
  const { data: channels, isLoading: channelsLoading } = useSearchChannels(
    debouncedQuery,
    platform,
    20
  );
  const { data: categories, isLoading: categoriesLoading } = useSearchCategories(
    debouncedQuery,
    platform,
    4
  );

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
    if (!channels || !searchQuery) return { topMatches: [], otherMatches: [] };

    const normalizedQuery = searchQuery.toLowerCase().trim();
    const top: UnifiedChannel[] = [];
    const others: UnifiedChannel[] = [];
    const seenIds = new Set<string>();

    // Pre-sort channels to ensure we keep the "best" version when deduplicating
    // Priority: Live > Exact Match > Has Avatar
    const sortedChannels = [...channels].sort((a, b) => {
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
  }, [channels, searchQuery]);

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

  const executeSearch = (term: string) => {
    if (!term.trim()) return;
    addSearch(term);
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
    addSearch(channel.displayName);
    setIsFocused(false);
    setSearchQuery(channel.displayName); // Update input with selected name

    if (onSelectChannel) {
      e?.preventDefault(); // Prevent navigation if we're just selecting
      onSelectChannel(channel);
    }
  };

  const handleCategoryClick = (category: UnifiedCategory, e?: React.MouseEvent) => {
    addSearch(category.name);
    setIsFocused(false);
    setSearchQuery("");

    if (onSelectCategory) {
      e?.preventDefault();
      onSelectCategory(category);
    }
  };

  const hasResults = shouldFetch && ((channels?.length || 0) > 0 || (categories?.length || 0) > 0);
  const showHistory = isFocused && !searchQuery && history.length > 0;
  const showSuggestions =
    isFocused && searchQuery.length > 0 && (hasResults || channelsLoading || categoriesLoading);
  const showDropdown = showHistory || showSuggestions;

  // Helper to format follower count
  const formatFollowerCount = (count: number | undefined): string | null => {
    if (count === undefined || count === null) return null;
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1).replace(/\.0$/, "")}M followers`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}K followers`;
    }
    return `${count} followers`;
  };

  // Helper to render channel items
  const ChannelItem = ({
    channel,
    onClick,
  }: {
    channel: UnifiedChannel;
    onClick: (c: UnifiedChannel, e: React.MouseEvent) => void;
  }) => {
    // If onSelectChannel is provided, we use a div, otherwise a Link
    const Wrapper = onSelectChannel ? "div" : Link;
    const linkProps = onSelectChannel
      ? {}
      : {
          to: "/stream/$platform/$channel",
          params: { platform: channel.platform, channel: channel.username },
          search: { tab: "videos" },
        };

    // Fallback for when avatar fails to load
    const avatarFallback = (
      <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center">
        <span className="text-xs font-bold text-white uppercase">
          {channel.displayName.slice(0, 1)}
        </span>
      </div>
    );

    const followerText = formatFollowerCount(channel.followerCount);

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
          <p className="font-bold text-sm text-[var(--color-foreground)] group-hover:text-[var(--color-storm-primary)] truncate">
            {channel.displayName}
          </p>
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            {!platform && <span className="capitalize">{channel.platform}</span>}
            {followerText && <span>{followerText}</span>}
            {channel.isLive && <span className="text-red-500 font-bold">• LIVE</span>}
          </div>
        </div>
      </Wrapper>
    );
  };

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
            "w-full h-9 pl-10 pr-10 rounded-full bg-[var(--color-background-secondary)] border border-[var(--color-border)] text-sm font-bold text-[var(--color-foreground)] placeholder:text-[var(--color-foreground-muted)] placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-white/50 focus:border-white transition-all",
            inputClassName
          )}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          // Prevent default autocomplete
          autoComplete="off"
        />

        {searchQuery && (
          <button
            onClick={handleClear}
            className={cn(
              "absolute right-3 top-1/2 -translate-y-1/2 transition-colors hover:text-white",
              isFocused ? "text-white" : "text-[var(--color-foreground-muted)]"
            )}
            title="Clear search"
            type="button"
          >
            <LuX size={16} />
          </button>
        )}
      </div>

      {/* Suggestions Dropdown */}
      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#0F0F12] border border-[var(--color-border)] rounded-xl overflow-hidden shadow-2xl animate-in fade-in slide-in-from-top-1 duration-200 flex flex-col max-h-[60vh] overflow-y-auto">
          {/* SEARCH HISTORY */}
          {showHistory && (
            <div className="py-2">
              {/* Header for history? Optional */}
              {filteredHistory.map((term) => (
                <div
                  key={term}
                  className="flex items-center justify-between px-4 py-2 hover:bg-[var(--color-background-secondary)] transition-colors group cursor-pointer"
                  onClick={() => executeSearch(term)}
                >
                  <div className="flex items-center gap-3 text-white/50 group-hover:text-white transition-colors">
                    <LuClock size={16} />
                    <span className="font-medium text-sm text-white/70 group-hover:text-white">
                      {term}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSearch(term);
                      }}
                      className="p-1 text-white/50 hover:text-red-500 transition-colors"
                      title="Remove from history"
                      type="button"
                    >
                      <LuX size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* BEST MATCHES */}
          {topMatches.length > 0 && (
            <div className={cn("py-2", showHistory && "border-t border-[var(--color-border)]")}>
              <h3 className="px-4 py-1.5 text-xs font-bold text-[var(--color-storm-primary)] uppercase tracking-wider flex items-center gap-2">
                <LuSparkles size={12} /> Best Match
              </h3>
              {topMatches.map((channel) => (
                <ChannelItem
                  key={`${channel.platform}-${channel.id}`}
                  channel={channel}
                  onClick={handleChannelClick}
                />
              ))}
            </div>
          )}

          {/* OTHER CHANNELS SUGGESTIONS */}
          {otherMatches.length > 0 && (
            <div
              className={cn(
                "py-2",
                (showHistory || topMatches.length > 0) && "border-t border-[var(--color-border)]"
              )}
            >
              <h3 className="px-4 py-1.5 text-xs font-bold text-[var(--color-foreground-muted)] uppercase tracking-wider flex items-center gap-2">
                <LuUser size={12} /> Channels
              </h3>
              {otherMatches.map((channel) => (
                <ChannelItem
                  key={`${channel.platform}-${channel.id}`}
                  channel={channel}
                  onClick={handleChannelClick}
                />
              ))}
            </div>
          )}

          {/* CATEGORIES SUGGESTIONS */}
          {showCategories && categories && categories.length > 0 && (
            <div className={cn("py-2 border-t border-[var(--color-border)]")}>
              <h3 className="px-4 py-1.5 text-xs font-bold text-[var(--color-foreground-muted)] uppercase tracking-wider flex items-center gap-2">
                <LuLayoutGrid size={12} /> Categories
              </h3>
              {categories.map((category) => {
                const Wrapper = onSelectCategory ? "div" : Link;
                const linkProps = onSelectCategory
                  ? {}
                  : {
                      to: "/categories/$platform/$categoryId",
                      params: { platform: category.platform, categoryId: category.id },
                    };

                return (
                  // @ts-expect-error
                  <Wrapper
                    key={`${category.platform}-${category.id}`}
                    {...linkProps}
                    onClick={(e: React.MouseEvent) => handleCategoryClick(category, e)}
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
                      <div className="flex items-center gap-2 text-xs text-[var(--color-foreground-muted)]">
                        {!platform && <span className="capitalize">{category.platform}</span>}
                      </div>
                    </div>
                  </Wrapper>
                );
              })}
            </div>
          )}

          {onSearch && searchQuery.length > 0 && (
            <div className="p-2 border-t border-[var(--color-border)] bg-[var(--color-background-secondary)]/50">
              <button
                onClick={() => executeSearch(searchQuery)}
                className="w-full py-2 text-sm font-bold text-[var(--color-storm-primary)] hover:underline flex items-center justify-center gap-1"
              >
                <LuSearch size={14} />
                See all results for "{searchQuery}"
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
