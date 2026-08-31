import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen } from "../../test-utils";

const searchState = vi.hoisted(() => ({
  submittedQueries: [] as string[],
}));

vi.mock("@/features/discovery/data/queries/useSearch", () => ({
  useProviderIsolatedSearchAll: (query: string) => {
    searchState.submittedQueries.push(query);
    return {
      data: {
        channels: [
          {
            id: `channel-${query}`,
            platform: "twitch" as const,
            username: query,
            displayName: `Result ${query}`,
            avatarUrl: "",
            isLive: false,
            isVerified: false,
            isPartner: false,
            followerCount: 1,
          },
        ],
        categories: [],
        streams: [],
        videos: [],
        clips: [],
      },
      isLoading: false,
    };
  },
  useSearchChannels: () => ({
    data: { pages: [] },
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useSearchCategories: () => ({
    data: { pages: [] },
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useSearchStreams: () => ({ data: [], isLoading: false }),
  useSearchVideos: () => ({
    data: [],
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useSearchClips: () => ({
    data: [],
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));

vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: <T,>(value: T) => value,
}));

vi.mock("@/features/discovery/data/useSearchHistory", () => ({
  useSearchHistory: () => ({
    history: [],
    addSearch: vi.fn(),
    removeSearch: vi.fn(),
    clearHistory: vi.fn(),
  }),
}));

vi.mock("@/components/ui/proxied-image", () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

import { SearchBar } from "@/features/shell/components/TopNavBar/SearchBar";
import { SearchPage } from "@/pages/SearchResults";

async function renderSearchFlow() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_app",
    component: () => (
      <>
        <SearchBar />
        <Outlet />
      </>
    ),
  });
  const categoriesRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/categories",
    component: () => <div>Categories route</div>,
  });
  const searchRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/search",
    validateSearch: (search: Record<string, unknown>) => ({
      q: typeof search.q === "string" ? search.q : "",
    }),
    component: SearchPage,
  });
  const history = createMemoryHistory({ initialEntries: ["/categories"] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([appRoute.addChildren([categoriesRoute, searchRoute])]),
    history,
  });

  await act(async () => {
    await router.load();
  });

  return {
    history,
    router,
    view: renderWithProviders(<RouterProvider router={router} />),
  };
}

// Guards: submitting from the persistent navbar while already on /search updates q, heading, and results instead of only closing autocomplete.
// Guards: rapid typing submits only the latest visible footer term; intermediate terms never become full Search Results queries.
describe("SearchBar same-route Search navigation", () => {
  afterEach(() => {
    searchState.submittedQueries = [];
    vi.restoreAllMocks();
  });

  it("publishes the latest rapid-typing term on a same-route footer submission", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const { history, router, view } = await renderSearchFlow();
    const input = screen.getByPlaceholderText("Search StreamFusion...");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xqc" } });
    fireEvent.click(screen.getByRole("button", { name: 'See all results for "xqc"' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/search");
      expect(router.state.location.search).toEqual({ q: "xqc" });
      expect(screen.getByRole("heading", { name: 'Search Results for "xqc"' })).toBeInTheDocument();
      expect(screen.getAllByText("Result xqc").length).toBeGreaterThan(0);
    });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "n" } });
    fireEvent.change(input, { target: { value: "ni" } });
    fireEvent.change(input, { target: { value: "ninja" } });
    expect(screen.queryByText('See all results for "xqc"')).not.toBeInTheDocument();
    const latestFooter = screen.getByRole("button", {
      name: 'See all results for "ninja"',
    });

    fireEvent.click(latestFooter);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/search");
      expect(router.state.location.search).toEqual({ q: "ninja" });
      expect(
        screen.getByRole("heading", { name: 'Search Results for "ninja"' })
      ).toBeInTheDocument();
      expect(screen.getAllByText("Result ninja").length).toBeGreaterThan(0);
      expect(screen.queryByText("Result xqc")).not.toBeInTheDocument();
    });

    expect(new Set(searchState.submittedQueries)).toEqual(new Set(["xqc", "ninja"]));
    view.unmount();
    history.destroy();
  });
});
