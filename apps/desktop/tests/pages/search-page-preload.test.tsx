import { describe, expect, it, vi } from "vitest";

const searchPageModuleMockState = vi.hoisted(() => ({
  loaded: vi.fn(),
}));

const LoadedSearchPage = () => null;

vi.mock("@/pages/SearchResults", () => {
  searchPageModuleMockState.loaded();
  return { SearchPage: LoadedSearchPage };
});

// Guards: repeated preload calls share one Search Results module load.
describe("Search Results route preload", () => {
  it("loads once and leaves the route synchronously renderable", async () => {
    const { preloadSearchPage, SearchPage } =
      await import("@/features/discovery/routes/search-page");

    await Promise.all([preloadSearchPage(), preloadSearchPage()]);

    expect(searchPageModuleMockState.loaded).toHaveBeenCalledTimes(1);
    expect(() => SearchPage()).not.toThrow();
    expect(SearchPage().type).toBe(LoadedSearchPage);
  });
});
