import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ContentTabs } from "@/features/playback/components/related-content/ContentTabs";

// Guards: Home, Videos, and Clips tab links must stay on the current stream route and use client-side hash navigation.
describe("ContentTabs stream navigation", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("preserves the stream pathname while navigating every tab without a document navigation", async () => {
    window.history.replaceState({}, "", "/index.html#/stream/kick/nicklee?tab=home");

    const rootRoute = createRootRoute();
    const streamRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/stream/$platform/$channel",
      validateSearch: (search: Record<string, unknown>) => ({
        tab: typeof search.tab === "string" ? search.tab : undefined,
      }),
      component: () => <ContentTabs activeTab="home" />,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([streamRoute]),
      history: createHashHistory(),
    });
    await act(() => router.load());

    const view = render(<RouterProvider router={router} />);

    for (const tab of ["Videos", "Clips", "Home"]) {
      const link = screen.getByRole("link", { name: tab });
      const expectedTab = tab.toLowerCase();

      expect(link).toHaveAttribute("href", `/index.html#/stream/kick/nicklee?tab=${expectedTab}`);
      const click = new MouseEvent("click", {
        bubbles: true,
        button: 0,
        cancelable: true,
      });
      await act(async () => {
        fireEvent(link, click);
        await router.load();
      });

      expect(click.defaultPrevented).toBe(true);
      expect(router.state.location.pathname).toBe("/stream/kick/nicklee");
      expect(router.state.location.search).toEqual({ tab: expectedTab });
    }

    view.unmount();
    router.history.destroy();
  });
});
