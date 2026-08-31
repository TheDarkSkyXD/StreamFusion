import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const streamModuleMocks = vi.hoisted(() => ({
  preloadChatPanel: vi.fn<(platform?: "twitch" | "kick") => Promise<unknown>>(),
}));

vi.mock("@/pages/Stream", () => ({
  StreamPage: () => null,
}));

vi.mock("@/pages/Stream/preload-chat-panel", () => ({
  preloadChatPanel: streamModuleMocks.preloadChatPanel,
}));

// Guards: route intent loading shares one promise with navigation and does not load twice.
// Guards: the initial shell does not inherit route preloading unless a route opts into it.
// Guards: Stream intent loading includes its nested chat surface before navigation completes.
describe("preloadable route", () => {
  afterEach(() => {
    streamModuleMocks.preloadChatPanel.mockReset();
    vi.resetModules();
  });

  it("lets TanStack preload the matched component before navigation without loading it twice", async () => {
    const Page = () => null;
    const load = vi.fn(async () => ({ default: Page }));
    const { createPreloadableRoute } = await import("@/routes/preloadable-route");
    const streamPage = createPreloadableRoute(load);
    const rootRoute = createRootRoute();
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => null,
    });
    const streamRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/stream/$platform/$channel",
      component: streamPage.Component,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([homeRoute, streamRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });

    await router.load();
    await router.preloadRoute({
      to: "/stream/$platform/$channel",
      params: { platform: "kick", channel: "blame" },
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(() => streamPage.Component()).not.toThrow();

    await router.navigate({
      to: "/stream/$platform/$channel",
      params: { platform: "kick", channel: "blame" },
    });
    await router.load();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps the initial shell independent from page chunks while preserving Stream intent preload", async () => {
    const preload = vi.fn(async () => undefined);
    const Page = Object.assign(() => null, { preload });
    const { withSuspense } = await import("@/routes/router");

    expect(withSuspense(Page)).not.toHaveProperty("preload");
    expect(withSuspense(Page, { forwardPreload: true })).toHaveProperty("preload", preload);
  });

  it("throws the shared load promise when clicked before preload finishes", async () => {
    let finishLoad: ((module: { default: () => null }) => void) | undefined;
    const loadPromise = new Promise<{ default: () => null }>((resolve) => {
      finishLoad = resolve;
    });
    const Page = () => null;

    const { createPreloadableRoute } = await import("@/routes/preloadable-route");
    const route = createPreloadableRoute(() => loadPromise);

    let suspendedOn: unknown;
    try {
      route.Component();
    } catch (error) {
      suspendedOn = error;
    }
    expect(suspendedOn).toBeInstanceOf(Promise);
    expect(suspendedOn).toBe(route.preload());

    finishLoad?.({ default: Page });
    await route.preload();
    expect(route.Component().type).toBe(Page);
  });

  it("finishes Stream route preloading only after the nested ChatPanel is ready", async () => {
    let resolveChat: (() => void) | undefined;
    streamModuleMocks.preloadChatPanel.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveChat = resolve;
      })
    );
    const { preloadStreamPage } = await import("@/features/playback/routes");

    const preload = preloadStreamPage("kick");
    await vi.waitFor(() => expect(streamModuleMocks.preloadChatPanel).toHaveBeenCalledTimes(1));
    expect(streamModuleMocks.preloadChatPanel).toHaveBeenCalledWith("kick");

    let settled = false;
    void preload.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveChat?.();
    await expect(preload).resolves.toBeUndefined();
  });
});
