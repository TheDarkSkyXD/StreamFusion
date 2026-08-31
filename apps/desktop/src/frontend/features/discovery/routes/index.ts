import { lazy } from "react";

import { preloadSearchPage } from "./search-page";

export { validateCategoryDetailSearch } from "./category-detail-search";
export { SearchPage, preloadSearchPage } from "./search-page";

export function validateSearchQuery(search: Record<string, unknown>): { q: string } {
  return { q: typeof search.q === "string" ? search.q : "" };
}

export const HomePage = lazy(() =>
  import("../../../pages/Home").then((module) => ({ default: module.HomePage }))
);
export const FollowingPage = lazy(() =>
  import("../../../pages/Following").then((module) => ({ default: module.FollowingPage }))
);
export const CategoriesPage = lazy(() =>
  import("../../../pages/Categories").then((module) => ({ default: module.CategoriesPage }))
);
export const CategoryDetailPage = lazy(() =>
  import("../../../pages/CategoryDetail").then((module) => ({
    default: module.CategoryDetailPage,
  }))
);
export const discoveryPageChunkLoaders = [
  () => import("../../../pages/Home"),
  () => import("../../../pages/Following"),
  () => import("../../../pages/Categories"),
  () => import("../../../pages/CategoryDetail"),
  preloadSearchPage,
];
