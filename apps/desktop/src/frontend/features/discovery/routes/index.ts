import { createPreloadableRoute } from "@/routes/preloadable-route";

export { validateCategoryDetailSearch } from "./category-detail-search";
export { SearchPage, preloadSearchPage } from "./search-page";

export function validateSearchQuery(search: Record<string, unknown>): { q: string } {
  return { q: typeof search.q === "string" ? search.q : "" };
}

export const HomePage = createPreloadableRoute(() =>
  import("../../../pages/Home").then((module) => ({ default: module.HomePage }))
).Component;
export const FollowingPage = createPreloadableRoute(() =>
  import("../../../pages/Following").then((module) => ({ default: module.FollowingPage }))
).Component;
export const CategoriesPage = createPreloadableRoute(() =>
  import("../../../pages/Categories").then((module) => ({ default: module.CategoriesPage }))
).Component;
export const CategoryDetailPage = createPreloadableRoute(() =>
  import("../../../pages/CategoryDetail").then((module) => ({
    default: module.CategoryDetailPage,
  }))
).Component;
