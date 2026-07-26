import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { createElement, type ReactNode, useRef, useState } from "react";

export function RelatedContentStoryRouter({
  children,
  initialPath = "/stream/twitch/novaarcade?tab=home",
}: {
  children: ReactNode;
  initialPath?: string;
}) {
  const childrenRef = useRef(children);
  childrenRef.current = children;

  const [router] = useState(() => {
    const rootRoute = createRootRoute({ component: Outlet });
    const appRoute = createRoute({
      getParentRoute: () => rootRoute,
      id: "_app",
      component: Outlet,
    });
    const streamRoute = createRoute({
      getParentRoute: () => appRoute,
      path: "/stream/$platform/$channel",
      validateSearch: (search: Record<string, unknown>) => ({
        tab: typeof search.tab === "string" ? search.tab : undefined,
      }),
      component: () => childrenRef.current,
    });
    const videoRoute = createRoute({
      getParentRoute: () => appRoute,
      path: "/video/$platform/$videoId",
      validateSearch: (search: Record<string, unknown>) => search,
      component: () => null,
    });
    const categoryRoute = createRoute({
      getParentRoute: () => appRoute,
      path: "/categories/$platform/$categoryId",
      component: () => null,
    });

    return createRouter({
      routeTree: rootRoute.addChildren([
        appRoute.addChildren([streamRoute, videoRoute, categoryRoute]),
      ]),
      history: createMemoryHistory({ initialEntries: [initialPath] }),
      defaultPendingMinMs: 0,
    });
  });

  return createElement(RouterProvider, { router });
}
