import { createPreloadableRoute } from "@/routes/preloadable-route";

const searchPageRoute = createPreloadableRoute(() =>
  import("../components/screens/SearchResults").then((module) => ({ default: module.SearchPage }))
);

export const SearchPage = searchPageRoute.Component;
export const preloadSearchPage = SearchPage.preload;
