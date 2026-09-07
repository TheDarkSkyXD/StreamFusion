import { createPreloadableRoute } from "@/routes/preloadable-route";

export { validateCategoryDetailSearch } from "./category-detail-search";
export { SearchPage, preloadSearchPage } from "./search-page";

export function validateSearchQuery(search: Record<string, unknown>): { q: string } {
  return { q: typeof search.q === "string" ? search.q : "" };
}

export const HomePage = createPreloadableRoute(() =>
  import("../components/screens/Home").then((module) => ({ default: module.HomePage }))
).Component;
export const FollowingPage = createPreloadableRoute(() =>
  import("../components/screens/Following").then((module) => ({ default: module.FollowingPage }))
).Component;
export const CategoriesPage = createPreloadableRoute(() =>
  import("../components/screens/Categories").then((module) => ({ default: module.CategoriesPage }))
).Component;
export const CategoryDetailPage = createPreloadableRoute(() =>
  import("../components/screens/CategoryDetail").then((module) => ({
    default: module.CategoryDetailPage,
  }))
).Component;
