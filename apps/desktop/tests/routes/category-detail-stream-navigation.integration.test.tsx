import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  fixtures,
  installElectronAPIMock,
  renderWithProviders,
  screen,
  waitFor,
} from "../test-utils";

vi.mock("@/hooks/queries/useCategories", () => ({
  useCategoryById: vi.fn((id: string, platform: "twitch" | "kick") => ({
    data: fixtures.category({ id, platform, name: "Just Chatting" }),
    isLoading: false,
  })),
  useTopCategories: vi.fn(() => ({ data: [] })),
}));

vi.mock("@/hooks/queries/useInfiniteStreams", () => ({
  useInfiniteStreamsByCategory: vi.fn(() => ({
    data: { pages: [] },
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    error: null,
    refetch: vi.fn(),
  })),
}));

vi.mock("@/components/stream/stream-grid", () => ({
  StreamGrid: () => (
    <Link
      to="/stream/$platform/$channel"
      params={{ platform: "twitch", channel: "ninja" }}
      search={{ tab: "home" }}
    >
      Watch Ninja
    </Link>
  ),
}));

import { CategoryDetailPage } from "@/pages/CategoryDetail";
import { validateCategoryDetailSearch } from "@/routes/category-detail-search";

// Guards: leaving a Category for a Stream cannot be hijacked by Category-only search canonicalization
it("keeps navigation on the selected Stream when its watch tab is home", async () => {
  installElectronAPIMock();
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_app",
    component: () => <Outlet />,
  });
  const categoryRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/categories/$platform/$categoryId",
    validateSearch: validateCategoryDetailSearch,
    component: CategoryDetailPage,
  });
  const streamRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/stream/$platform/$channel",
    component: () => <div>Watching test stream</div>,
  });
  const history = createMemoryHistory({
    initialEntries: [
      "/categories/twitch/509658?tab=live&platform=all&language=&tag=&sort=desc&otherId=15",
    ],
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([appRoute.addChildren([categoryRoute, streamRoute])]),
    history,
  });
  await act(async () => {
    await router.load();
  });
  const view = renderWithProviders(<RouterProvider router={router} />);

  await act(async () => {
    screen.getByRole("link", { name: "Watch Ninja" }).click();
  });

  await waitFor(() => {
    expect(router.state.location.pathname).toBe("/stream/twitch/ninja");
    expect(screen.getByText("Watching test stream")).toBeInTheDocument();
  });

  view.unmount();
  history.destroy();
});
