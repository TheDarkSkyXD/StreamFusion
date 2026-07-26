import type { Decorator } from "@storybook/react-vite";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { useMemo } from "react";

function StoryRouter({ Story }: { Story: Parameters<Decorator>[0] }) {
  const router = useMemo(() => {
    const rootRoute = createRootRoute({ component: Outlet });
    const canvasRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: Story,
    });
    const streamRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/stream/$platform/$channel",
      validateSearch: (search: Record<string, unknown>) => ({
        tab: typeof search.tab === "string" ? search.tab : undefined,
      }),
    });
    const categoryRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/categories/$platform/$categoryId",
      validateSearch: (search: Record<string, unknown>) => ({
        otherId: typeof search.otherId === "string" ? search.otherId : undefined,
      }),
    });
    const searchRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/search",
      validateSearch: (search: Record<string, unknown>) => ({
        q: typeof search.q === "string" ? search.q : undefined,
      }),
    });

    return createRouter({
      routeTree: rootRoute.addChildren([canvasRoute, streamRoute, categoryRoute, searchRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
      defaultPendingMinMs: 0,
    });
  }, [Story]);

  return <RouterProvider router={router} />;
}

export const withAppRouter: Decorator = (Story) => <StoryRouter Story={Story} />;
