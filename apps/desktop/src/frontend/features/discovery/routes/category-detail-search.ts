import {
  parseCategoryLanguage,
  type CategoryLanguage,
} from "@/features/discovery/data/category-language-preference-store";

export type CategoryContentTab = "live" | "clips" | "videos";
export type CategoryPlatformScope = "all" | "twitch" | "kick";
export type CategoryViewerSort = "desc" | "asc";

export interface CategoryDetailSearch {
  tab?: CategoryContentTab;
  platform?: CategoryPlatformScope;
  language?: CategoryLanguage;
  tag?: string;
  sort?: CategoryViewerSort;
  otherId?: string;
}

export function validateCategoryDetailSearch(
  search: Record<string, unknown>
): CategoryDetailSearch {
  const otherId =
    typeof search.otherId === "string" && search.otherId.length > 0
      ? search.otherId
      : typeof search.otherId === "number" && Number.isFinite(search.otherId)
        ? String(search.otherId)
        : undefined;
  return {
    tab:
      search.tab === "clips" || search.tab === "videos" || search.tab === "live"
        ? search.tab
        : "live",
    platform: search.platform === "twitch" || search.platform === "kick" ? search.platform : "all",
    language: parseCategoryLanguage(search.language),
    tag: typeof search.tag === "string" ? search.tag : "",
    sort: search.sort === "asc" ? "asc" : "desc",
    otherId,
  };
}
