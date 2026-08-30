import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { MouseEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LuArrowLeft } from "react-icons/lu";

import type { UnifiedCategory } from "@shared/platform-types";
import { CategoryFilterBar } from "@/features/discovery/components/discovery/category-filter-bar";
import { StreamGrid } from "@/features/discovery/components/stream/stream-grid";
import { ProxiedImage } from "@/components/ui/proxied-image";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getQueryCacheOptions } from "@/features/discovery/data/queries/cache-policy";
import { useCategoryById, useInfiniteTopCategories } from "@/features/discovery/data/queries/useCategories";
import { useInfiniteStreamsByCategory } from "@/features/discovery/data/queries/useInfiniteStreams";
import { useDebounce } from "@/hooks/useDebounce";
import { getStreamElementKey } from "@/lib/id-utils";
import { formatViewerCount, getEquivalentCategoryName, normalizeCategoryName } from "@/lib/utils";
import type {
  CategoryContentTab,
  CategoryDetailSearch,
  CategoryPlatformScope,
} from "@/features/discovery/routes/category-detail-search";
import { validateCategoryDetailSearch } from "@/features/discovery/routes/category-detail-search";
import type { Platform } from "@shared/auth-types";

import { CategoryMediaTab } from "./components/CategoryMediaTab";

function getSavedClipTimeRange(): "day" | "week" | "month" | "all" {
  const saved = localStorage.getItem("clips-filter-preference");
  return saved === "day" || saved === "week" || saved === "month" || saved === "all"
    ? saved
    : "all";
}

const PAGE_SIZE = 30;
const CATEGORY_ROUTE = "/categories/$platform/$categoryId" as const;
const CATEGORY_SEARCH_KEYS = ["tab", "platform", "language", "tag", "sort", "otherId"] as const;

const CATEGORY_TABS: Array<{ value: CategoryContentTab; label: string }> = [
  { value: "live", label: "Live Streams" },
  { value: "clips", label: "Clips" },
  { value: "videos", label: "Videos" },
];

const PLATFORM_SCOPES: Array<{ value: CategoryPlatformScope; label: string }> = [
  { value: "all", label: "All" },
  { value: "twitch", label: "Twitch" },
  { value: "kick", label: "Kick" },
];

function resetContentScroll() {
  const scrollArea = document.getElementById("main-content-scroll-area");
  if (scrollArea) scrollArea.scrollTop = 0;
}

function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

function needsCanonicalSearch(
  rawSearch: Record<string, unknown>,
  canonicalSearch: CategoryDetailSearch
) {
  return CATEGORY_SEARCH_KEYS.some((key) => {
    const rawValue = rawSearch[key];
    const canonicalValue = canonicalSearch[key];
    if (
      key === "otherId" &&
      typeof rawValue === "number" &&
      Number.isFinite(rawValue) &&
      String(rawValue) === canonicalValue
    ) {
      return false;
    }
    return rawValue !== canonicalValue;
  });
}

function selectedPlatformClasses(scope: CategoryPlatformScope) {
  if (scope === "twitch") return "bg-[#9146FF] text-white";
  if (scope === "kick") return "bg-[#53FC18] text-black";
  return "bg-white text-black";
}

export function CategoryDetailPage() {
  const { platform: routePlatform, categoryId } = useParams({
    from: "/_app/categories/$platform/$categoryId",
  });
  const routeSearch = useSearch({ from: "/_app/categories/$platform/$categoryId" });
  const location = useLocation();
  const navigate = useNavigate();
  const [clipSort, setClipSort] = useState<"views" | "recent">("views");
  const [videoSort, setVideoSort] = useState<"views" | "recent">("recent");
  const [clipTimeRange, setClipTimeRange] = useState(getSavedClipTimeRange);
  const [isCategoryNavStuck, setIsCategoryNavStuck] = useState(false);
  const { data: mergedCategoryCatalog } = useInfiniteTopCategories();

  const tab = routeSearch.tab ?? "live";
  const platformScope = routeSearch.platform ?? "all";
  const language = routeSearch.language ?? "";
  const rawTagQuery = routeSearch.tag ?? "";
  const sortOrder = routeSearch.sort ?? "desc";
  const otherId = routeSearch.otherId;
  const tagQuery = useDebounce(rawTagQuery, 200);
  const currentPlatform = routePlatform as Platform;
  const otherPlatform: Platform = currentPlatform === "twitch" ? "kick" : "twitch";
  const routePath = `/categories/${currentPlatform}/${categoryId}`;

  const currentSearch = useMemo<CategoryDetailSearch>(
    () => ({
      tab,
      platform: platformScope,
      language,
      tag: rawTagQuery,
      sort: sortOrder,
      otherId,
    }),
    [language, otherId, platformScope, rawTagQuery, sortOrder, tab]
  );

  useEffect(() => {
    if (location.pathname !== routePath) return;
    const rawSearch = location.search as Record<string, unknown>;
    const canonicalSearch = validateCategoryDetailSearch(rawSearch);
    if (!needsCanonicalSearch(rawSearch, canonicalSearch)) return;
    void navigate({
      to: CATEGORY_ROUTE,
      params: { platform: currentPlatform, categoryId },
      search: canonicalSearch,
      replace: true,
    });
  }, [categoryId, currentPlatform, location.pathname, location.search, navigate, routePath]);

  const { data: category, isLoading: isCategoryLoading } = useCategoryById(
    categoryId,
    currentPlatform
  );
  const providedOtherQuery = useCategoryById(otherId ?? "", otherPlatform);
  const providedOtherCategory = otherId ? providedOtherQuery.data : undefined;
  const providedOtherMatches = Boolean(
    otherId &&
    category?.name &&
    providedOtherCategory?.name &&
    normalizeCategoryName(category.name) === normalizeCategoryName(providedOtherCategory.name)
  );
  const shouldSearchForOtherCategory = Boolean(
    category?.name && (!otherId || (!providedOtherQuery.isLoading && !providedOtherMatches))
  );

  const otherCategorySearch = useQuery({
    queryKey: [
      "category-match",
      category?.name ? normalizeCategoryName(category.name) : null,
      otherPlatform,
    ],
    queryFn: async () => {
      if (!category?.name) return null;
      const normalizedKey = normalizeCategoryName(category.name);
      const searchQuery = getEquivalentCategoryName(normalizedKey, otherPlatform) ?? category.name;
      const response = await window.electronAPI.categories.search({
        query: searchQuery,
        platform: otherPlatform,
        limit: 10,
      });
      if (response.success === false) throw new Error(response.error);
      const candidates = (response.data as UnifiedCategory[]) ?? [];
      return (
        candidates.find((candidate) => normalizeCategoryName(candidate.name) === normalizedKey) ??
        null
      );
    },
    enabled: shouldSearchForOtherCategory,
    ...getQueryCacheOptions("categoryReference"),
  });

  const searchedOtherId = otherCategorySearch.data?.id;
  const identityIsPending =
    Boolean(otherId && providedOtherQuery.isLoading) ||
    (shouldSearchForOtherCategory && otherCategorySearch.isPending);
  const trustedOtherId = providedOtherMatches ? otherId : searchedOtherId;
  const linkOtherId =
    trustedOtherId ?? (identityIsPending || otherCategorySearch.isError ? otherId : undefined);
  const otherCategoryId = trustedOtherId ?? "";

  const navigationSearch = useMemo<CategoryDetailSearch>(
    () => ({ ...currentSearch, otherId: linkOtherId }),
    [currentSearch, linkOtherId]
  );

  const identityIsSettled =
    Boolean(category?.name) &&
    !providedOtherQuery.isLoading &&
    (providedOtherMatches || otherCategorySearch.isSuccess || otherCategorySearch.isError);

  useEffect(() => {
    if (location.pathname !== routePath || !identityIsSettled || otherCategorySearch.isError) {
      return;
    }
    if (linkOtherId === otherId) return;
    void navigate({
      to: CATEGORY_ROUTE,
      params: { platform: currentPlatform, categoryId },
      search: navigationSearch,
      replace: true,
    });
  }, [
    categoryId,
    currentPlatform,
    identityIsSettled,
    linkOtherId,
    location.pathname,
    navigate,
    navigationSearch,
    otherCategorySearch.isError,
    otherId,
    routePath,
  ]);

  const updateSearch = useCallback(
    (patch: Partial<CategoryDetailSearch>) => {
      resetContentScroll();
      void navigate({
        to: CATEGORY_ROUTE,
        params: { platform: currentPlatform, categoryId },
        search: { ...navigationSearch, ...patch },
      });
    },
    [categoryId, currentPlatform, navigate, navigationSearch]
  );

  const handleNativeLinkClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (isPlainPrimaryClick(event)) resetContentScroll();
  }, []);

  const categoryNavSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const sentinel = categoryNavSentinelRef.current;
    const root = document.getElementById("main-content-scroll-area");
    if (!sentinel || !root) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsCategoryNavStuck(!entry.isIntersecting),
      { root, threshold: 1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const otherCategoryName = useMemo(() => {
    if (otherPlatform !== "kick" || !category?.name) return undefined;
    const normalizedKey = normalizeCategoryName(category.name);
    return (
      otherCategorySearch.data?.name ??
      (providedOtherMatches ? providedOtherCategory?.name : undefined) ??
      getEquivalentCategoryName(normalizedKey, otherPlatform) ??
      category.name
    );
  }, [
    category?.name,
    otherCategorySearch.data?.name,
    otherPlatform,
    providedOtherCategory?.name,
    providedOtherMatches,
  ]);
  const twitchCategoryId = currentPlatform === "twitch" ? categoryId : otherCategoryId;
  const kickCategoryId = currentPlatform === "kick" ? categoryId : otherCategoryId;
  const kickCategorySlug =
    currentPlatform === "kick" ? category?.slug : (providedOtherCategory?.slug ?? category?.slug);
  const kickCategoryName = currentPlatform === "kick" ? category?.name : otherCategoryName;
  const isKickOnlyCategory = currentPlatform === "kick" && identityIsSettled && !otherCategoryId;
  const effectivePlatformScope = isKickOnlyCategory ? "kick" : platformScope;

  const updateClipTimeRange = useCallback((value: "day" | "week" | "month" | "all") => {
    setClipTimeRange(value);
    localStorage.setItem("clips-filter-preference", value);
  }, []);

  const langParam = language || undefined;
  const datasetKey = `${effectivePlatformScope}:${language}:${tagQuery}:${sortOrder}`;
  const primaryQuery = useInfiniteStreamsByCategory(
    categoryId,
    currentPlatform,
    PAGE_SIZE,
    currentPlatform === "kick" ? category?.name : undefined,
    langParam,
    datasetKey
  );
  const secondaryQuery = useInfiniteStreamsByCategory(
    otherCategoryId,
    otherPlatform,
    PAGE_SIZE,
    otherCategoryName,
    langParam,
    datasetKey
  );
  const hasSecondaryStreams = secondaryQuery.data?.pages.some((page) => page?.data?.some(Boolean));

  const { primaryStreamViewers, scopedMerged, secondaryStreamViewers, streams } = useMemo(() => {
    const primary = primaryQuery.data?.pages.flatMap((page) => page?.data ?? []) ?? [];
    const secondary = secondaryQuery.data?.pages.flatMap((page) => page?.data ?? []) ?? [];
    const seen = new Set<string>();
    const mergedList = [];
    for (const stream of [...primary, ...secondary]) {
      if (stream == null) continue;
      const key = getStreamElementKey(stream);
      if (seen.has(key)) continue;
      seen.add(key);
      mergedList.push(stream);
    }
    const scoped =
      effectivePlatformScope === "all"
        ? mergedList
        : mergedList.filter((stream) => stream.platform === effectivePlatformScope);
    const lowerTag = tagQuery.trim().toLowerCase();
    const filtered = lowerTag
      ? scoped.filter((stream) =>
          stream.tags?.some((streamTag) => streamTag.toLowerCase().includes(lowerTag))
        )
      : scoped;
    const sorted = [...filtered].sort((left, right) =>
      sortOrder === "desc"
        ? (right.viewerCount ?? 0) - (left.viewerCount ?? 0)
        : (left.viewerCount ?? 0) - (right.viewerCount ?? 0)
    );
    return {
      primaryStreamViewers: mergedList.reduce(
        (sum, stream) =>
          stream.platform === currentPlatform ? sum + (stream.viewerCount ?? 0) : sum,
        0
      ),
      scopedMerged: scoped,
      secondaryStreamViewers: mergedList.reduce(
        (sum, stream) =>
          stream.platform === otherPlatform ? sum + (stream.viewerCount ?? 0) : sum,
        0
      ),
      streams: sorted,
    };
  }, [
    currentPlatform,
    effectivePlatformScope,
    otherPlatform,
    primaryQuery.data,
    secondaryQuery.data,
    sortOrder,
    tagQuery,
  ]);

  const mergedCategory = category?.name
    ? mergedCategoryCatalog?.find(
        (candidate) =>
          normalizeCategoryName(candidate.name) === normalizeCategoryName(category.name)
      )
    : undefined;
  const loadedViewerTotal = primaryStreamViewers + secondaryStreamViewers;
  const totalViewers = mergedCategory?.crossPlatformId
    ? (mergedCategory.viewerCount ?? loadedViewerTotal)
    : (category?.viewerCount ?? primaryStreamViewers) + secondaryStreamViewers;
  const selectedQuery =
    effectivePlatformScope === "all"
      ? null
      : effectivePlatformScope === currentPlatform
        ? primaryQuery
        : secondaryQuery;
  const isStreamsLoading = selectedQuery
    ? selectedQuery.isLoading
    : primaryQuery.isLoading || secondaryQuery.isLoading;
  const isFetchingNextPage = selectedQuery
    ? selectedQuery.isFetchingNextPage
    : primaryQuery.isFetchingNextPage || secondaryQuery.isFetchingNextPage;
  const hasNextPage = selectedQuery
    ? selectedQuery.hasNextPage
    : primaryQuery.hasNextPage || secondaryQuery.hasNextPage;
  const selectedPlatformIsUnavailable = Boolean(selectedQuery?.error && scopedMerged.length === 0);

  const queriesRef = useRef({
    primaryQuery,
    secondaryQuery,
    platformScope: effectivePlatformScope,
    currentPlatform,
  });
  useLayoutEffect(() => {
    queriesRef.current = {
      primaryQuery,
      secondaryQuery,
      platformScope: effectivePlatformScope,
      currentPlatform,
    };
  }, [currentPlatform, effectivePlatformScope, primaryQuery, secondaryQuery]);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;

    const root = document.getElementById("main-content-scroll-area");
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        const state = queriesRef.current;
        const fetchPrimary =
          state.platformScope === "all" || state.platformScope === state.currentPlatform;
        const fetchSecondary =
          state.platformScope === "all" || state.platformScope !== state.currentPlatform;
        if (
          fetchPrimary &&
          state.primaryQuery.hasNextPage &&
          !state.primaryQuery.isFetchingNextPage
        ) {
          state.primaryQuery.fetchNextPage();
        }
        if (
          fetchSecondary &&
          state.secondaryQuery.hasNextPage &&
          !state.secondaryQuery.isFetchingNextPage
        ) {
          state.secondaryQuery.fetchNextPage();
        }
      },
      { root, threshold: 0, rootMargin: "1500px" }
    );
    observerRef.current.observe(node);
  }, []);

  return (
    <div className="p-6 h-full flex flex-col gap-6">
      <Link
        to="/categories"
        className="text-[var(--color-foreground-muted)] hover:text-white flex items-center gap-2 transition-colors w-fit"
      >
        <LuArrowLeft size={20} />
        Back to Categories
      </Link>

      {isCategoryLoading ? (
        <div className="animate-pulse motion-reduce:animate-none space-y-6">
          <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
            <div className="w-48 aspect-[3/4] bg-[var(--color-background-tertiary)] rounded-xl" />
            <div className="flex-1 space-y-4 w-full">
              <div className="h-12 w-3/4 md:w-1/2 bg-[var(--color-background-tertiary)] rounded" />
              <div className="h-6 w-1/4 bg-[var(--color-background-tertiary)] rounded" />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
          <div className="w-48 aspect-[3/4] bg-[var(--color-background-tertiary)] rounded-xl shadow-2xl flex items-center justify-center shrink-0 border border-[var(--color-border)] relative overflow-hidden group">
            {category?.boxArtUrl ? (
              <ProxiedImage
                src={category.boxArtUrl.replace("{width}", "285").replace("{height}", "380")}
                alt={category.name}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <span className="text-6xl" aria-hidden="true">
                🎮
              </span>
            )}
            <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent pointer-events-none" />
          </div>
          <div className="flex-1 text-center md:text-left space-y-2 pb-2">
            <h1 className="text-4xl md:text-6xl font-black tracking-tight">
              {category?.name ?? "Unknown Category"}
            </h1>
            <div className="flex items-center justify-center md:justify-start gap-1.5 text-lg">
              <span className="font-bold text-[var(--color-primary)] text-xl">
                {formatViewerCount(totalViewers)}
              </span>
              <span className="text-[var(--color-foreground-secondary)]">watching live</span>
            </div>
          </div>
        </div>
      )}

      <div ref={categoryNavSentinelRef} aria-hidden="true" className="h-px" />
      <nav
        aria-label="Category content"
        className={`sticky top-0 z-30 -mt-px flex min-h-11 items-end gap-5 border-b border-[var(--color-border)] transition-colors duration-150 ${
          isCategoryNavStuck
            ? "bg-[var(--color-background-secondary)]"
            : "bg-[var(--color-background-primary)]"
        }`}
      >
        {CATEGORY_TABS.map(({ value, label }) => {
          const isSelected = tab === value;
          return (
            <Link
              key={value}
              to={CATEGORY_ROUTE}
              params={{ platform: currentPlatform, categoryId }}
              search={{ ...navigationSearch, tab: value }}
              aria-current={isSelected ? "page" : undefined}
              onClick={handleNativeLinkClick}
              className={`relative inline-flex min-h-11 items-center px-1 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                isSelected ? "text-white" : "text-[var(--color-foreground-muted)] hover:text-white"
              }`}
            >
              {label}
              {isSelected && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--color-primary)]"
                />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {!isKickOnlyCategory && (
          <div
            role="group"
            aria-label="Platform"
            className="flex min-h-10 w-full items-stretch rounded-lg bg-[var(--color-background-tertiary)] p-1 sm:w-fit"
          >
            {PLATFORM_SCOPES.map(({ value, label }) => {
              const isSelected = platformScope === value;
              return (
                <Link
                  key={value}
                  to={CATEGORY_ROUTE}
                  params={{ platform: currentPlatform, categoryId }}
                  search={{ ...navigationSearch, platform: value }}
                  aria-current={isSelected ? "page" : undefined}
                  onClick={handleNativeLinkClick}
                  className={`inline-flex min-h-10 flex-1 items-center justify-center rounded-md px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:flex-none ${
                    isSelected
                      ? selectedPlatformClasses(value)
                      : "text-[var(--color-foreground-secondary)] hover:bg-[var(--color-background-elevated)] hover:text-white"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        )}

        {tab === "live" && (
          <CategoryFilterBar
            language={language}
            onLanguageChange={(value) => updateSearch({ language: value })}
            tagQuery={rawTagQuery}
            onTagQueryChange={(value) => updateSearch({ tag: value })}
            sortOrder={sortOrder}
            onSortOrderChange={(value) => updateSearch({ sort: value })}
          />
        )}
        {tab !== "live" && (
          <div
            role="group"
            aria-label="Category filters"
            className="flex min-w-0 flex-wrap items-center gap-3"
          >
            <div role="group" aria-label="Category text filters">
              <CategoryFilterBar
                language={language}
                onLanguageChange={(value) => updateSearch({ language: value })}
                tagQuery={rawTagQuery}
                onTagQueryChange={(value) => updateSearch({ tag: value })}
                sortOrder={sortOrder}
                onSortOrderChange={(value) => updateSearch({ sort: value })}
                showViewerSort={false}
                compact
              />
            </div>
            <div
              role="group"
              aria-label={`Category ${tab} filters`}
              className="flex min-w-0 flex-wrap items-center gap-3 sm:ml-auto sm:justify-end"
            >
              {tab === "clips" && (
                <label className="flex items-center gap-2 text-xs font-semibold text-[var(--color-foreground-secondary)]">
                  <span>Time</span>
                  <Select value={clipTimeRange} onValueChange={updateClipTimeRange}>
                    <SelectTrigger
                      aria-label="Filter clips by time range"
                      className="h-8 min-w-[108px] px-2.5 text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">Last Day</SelectItem>
                      <SelectItem value="week">Last Week</SelectItem>
                      <SelectItem value="month">Last Month</SelectItem>
                      <SelectItem value="all">All Time</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              )}
              <label className="flex items-center gap-2 text-xs font-semibold text-[var(--color-foreground-secondary)]">
                <span>Sort</span>
                <Select
                  value={tab === "clips" ? clipSort : videoSort}
                  onValueChange={(value) =>
                    tab === "clips"
                      ? setClipSort(value as "views" | "recent")
                      : setVideoSort(value as "views" | "recent")
                  }
                >
                  <SelectTrigger
                    aria-label={`Sort Category ${tab}`}
                    className="h-8 min-w-[112px] px-2.5 text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="views">Views</SelectItem>
                    <SelectItem value="recent">Most Recent</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
          </div>
        )}
      </div>

      {tab === "live" && (
        <>
          {platformScope === "all" && primaryQuery.error && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-4"
            >
              <span>{currentPlatform === "twitch" ? "Twitch" : "Kick"} is unavailable.</span>
              <button
                type="button"
                onClick={() => void primaryQuery.refetch()}
                className="min-h-10 rounded-md bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Retry {currentPlatform === "twitch" ? "Twitch" : "Kick"}
              </button>
            </div>
          )}

          {platformScope === "all" &&
            !otherCategoryId &&
            otherCategorySearch.isError &&
            !hasSecondaryStreams && (
              <div
                role="status"
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-4"
              >
                <span>
                  {otherPlatform === "twitch" ? "Twitch" : "Kick"} streams are temporarily
                  unavailable.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (otherId) void providedOtherQuery.refetch();
                    void otherCategorySearch.refetch();
                  }}
                  className="min-h-10 rounded-md bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  Retry {otherPlatform === "twitch" ? "Twitch" : "Kick"}
                </button>
              </div>
            )}

          {selectedPlatformIsUnavailable && selectedQuery && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-4"
            >
              <span>{platformScope === "twitch" ? "Twitch" : "Kick"} is unavailable.</span>
              <button
                type="button"
                onClick={() => void selectedQuery.refetch()}
                className="min-h-10 rounded-md bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Retry {platformScope === "twitch" ? "Twitch" : "Kick"}
              </button>
            </div>
          )}

          {!selectedPlatformIsUnavailable && (
            <>
              <StreamGrid
                key={datasetKey}
                datasetKey={datasetKey}
                streams={streams}
                isLoading={isStreamsLoading}
                emptyMessage={
                  tagQuery && scopedMerged.length > 0
                    ? `No streams in this category match "${tagQuery}".`
                    : platformScope === "all"
                      ? "No active streams found for this category."
                      : `No live ${platformScope === "twitch" ? "Twitch" : "Kick"} streams found for this category.`
                }
                skeletons={8}
              />

              {hasNextPage && (
                <div className="relative h-14 flex items-center justify-center">
                  <div ref={sentinelRef} className="absolute inset-0" aria-hidden="true" />
                  {isFetchingNextPage && (
                    <div role="status" aria-label="Loading more live streams">
                      <div
                        aria-hidden="true"
                        className="animate-spin motion-reduce:animate-none rounded-full h-6 w-6 border-b-2 border-white"
                      />
                      <span className="sr-only">Loading more live streams</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab !== "live" && (
        <CategoryMediaTab
          kind={tab}
          platformScope={effectivePlatformScope}
          twitchCategoryId={twitchCategoryId}
          kickCategoryId={kickCategoryId}
          kickCategorySlug={kickCategorySlug}
          kickCategoryName={kickCategoryName}
          language={language}
          tag={rawTagQuery}
          direction={tab === "clips" ? "desc" : sortOrder}
          timeRange={clipTimeRange}
          sort={tab === "clips" ? clipSort : videoSort}
        />
      )}
    </div>
  );
}
