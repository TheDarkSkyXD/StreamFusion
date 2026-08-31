import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { LuRefreshCw, LuSearch, LuTriangleAlert } from "react-icons/lu";

import { VirtualizedCategoryGrid } from "@/features/discovery/components/discovery/virtualized-category-grid";
import { useInfiniteTopCategories } from "@/features/discovery/data/queries/useCategories";
import { useSearchCategories } from "@/features/discovery/data/queries/useSearch";
import {
  filterRankAndDeduplicateCategories,
  mergeExactCrossPlatformCategories,
} from "@/features/discovery/utils/search/category-search-contract";

const MIN_REMOTE_CATEGORY_SEARCH_LENGTH = 2;

export function CategoriesPage() {
  // Accumulate cursor pages while the virtualized grid keeps rendering only
  // the currently visible category cards.
  const {
    data: categories,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteTopCategories();
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = searchQuery.trim();
  const shouldSearchRemotely = normalizedSearchQuery.length >= MIN_REMOTE_CATEGORY_SEARCH_LENGTH;
  const remoteSearch = useSearchCategories(
    normalizedSearchQuery,
    undefined,
    20,
    shouldSearchRemotely
  );

  const localCategories = useMemo(() => {
    if (!normalizedSearchQuery) return categories || [];
    const query = searchQuery.toLowerCase();
    return categories?.filter((category) => category.name.toLowerCase().includes(query)) || [];
  }, [categories, normalizedSearchQuery, searchQuery]);
  const remoteCategories = useMemo(
    () =>
      mergeExactCrossPlatformCategories(
        filterRankAndDeduplicateCategories(
          remoteSearch.data?.pages.flatMap((page) => page.data) ?? [],
          normalizedSearchQuery
        )
      ),
    [normalizedSearchQuery, remoteSearch.data]
  );
  const filteredCategories = shouldSearchRemotely
    ? remoteSearch.data
      ? remoteCategories
      : localCategories
    : localCategories;
  const searchIsLoading =
    shouldSearchRemotely && remoteSearch.isLoading && localCategories.length === 0;
  const searchIsError =
    shouldSearchRemotely && remoteSearch.isError && localCategories.length === 0;
  const searchHasNextPage = shouldSearchRemotely ? remoteSearch.hasNextPage : hasNextPage;
  const searchIsFetchingNextPage = shouldSearchRemotely
    ? remoteSearch.isFetchingNextPage
    : isFetchingNextPage;
  const loadMore = shouldSearchRemotely
    ? () => void remoteSearch.fetchNextPage()
    : () => void fetchNextPage();

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  return (
    <div className="p-6 h-full flex flex-col overflow-hidden">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Categories</h1>
          <p className="text-[var(--color-foreground-secondary)]">
            {categories?.length
              ? `${categories.length} categories from Twitch & Kick`
              : "Browse streams by game or category"}
          </p>
        </div>

        <div className="relative w-full max-w-sm">
          <LuSearch
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-foreground-muted)]"
            size={16}
          />
          <input
            type="text"
            aria-label="Filter categories"
            placeholder="Filter categories..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="w-full h-10 pl-10 pr-4 rounded-lg bg-[var(--color-background-secondary)] border border-[var(--color-border)] text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-foreground-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent transition-colors"
          />
        </div>
      </div>

      <div className="mt-2 flex-1 min-h-0">
        {(isError || searchIsError) && filteredCategories.length === 0 && !searchIsLoading ? (
          <div
            role="alert"
            className="mx-auto mt-12 flex max-w-md flex-col items-center rounded-xl border border-amber-400/30 bg-amber-400/10 px-6 py-8 text-center"
          >
            <LuTriangleAlert className="mb-3 h-8 w-8 text-amber-300" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-white">
              {searchIsError ? "Couldn’t search categories" : "Couldn’t load categories"}
            </h2>
            <p className="mt-2 text-sm text-[var(--color-foreground-secondary)]">
              Twitch or Kick may be temporarily unavailable. Your saved browse data was not changed.
            </p>
            <button
              type="button"
              onClick={() => void (searchIsError ? remoteSearch.refetch() : refetch())}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-foreground)] transition-opacity hover:opacity-90"
            >
              <LuRefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </button>
          </div>
        ) : (
          <VirtualizedCategoryGrid
            categories={filteredCategories}
            isLoading={isLoading || searchIsLoading}
            isFetchingNextPage={searchIsFetchingNextPage}
            hasNextPage={searchHasNextPage}
            onLoadMore={loadMore}
            skeletonCount={12}
            scrollKey="categories-page"
            datasetKey={searchQuery.trim().toLowerCase() || "all"}
            emptyMessage={
              searchQuery ? `No categories matching "${searchQuery}"` : "No categories found"
            }
          />
        )}
      </div>
    </div>
  );
}
