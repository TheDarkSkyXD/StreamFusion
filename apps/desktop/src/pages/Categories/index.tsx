import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { LuSearch } from "react-icons/lu";

import { VirtualizedCategoryGrid } from "@/components/discovery/virtualized-category-grid";
import { useTopCategories } from "@/hooks/queries/useCategories";

export function CategoriesPage() {
  // Fetch ALL categories (cached, deduped with Twitch priority).
  // The list comes back fully — the grid is virtualized, so we hand the entire
  // filtered list straight to it and let windowing handle render perf.
  const { data: categories, isLoading } = useTopCategories();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories || [];
    const query = searchQuery.toLowerCase();
    return categories?.filter((category) => category.name.toLowerCase().includes(query)) || [];
  }, [categories, searchQuery]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  return (
    <div className="p-6 h-full flex flex-col">
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
            placeholder="Filter categories..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="w-full h-10 pl-10 pr-4 rounded-lg bg-[var(--color-background-secondary)] border border-[var(--color-border)] text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-foreground-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent transition-all"
          />
        </div>
      </div>

      <div className="mt-2 flex-1 min-h-0">
        <VirtualizedCategoryGrid
          categories={filteredCategories}
          isLoading={isLoading}
          skeletonCount={7}
          scrollKey="categories-page"
          emptyMessage={
            searchQuery ? `No categories matching "${searchQuery}"` : "No categories found"
          }
        />
      </div>
    </div>
  );
}
