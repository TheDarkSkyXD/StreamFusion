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
const historyModuleMocks = vi.hoisted(() => ({
  loaded: vi.fn(),
}));

vi.mock("@/pages/Stream", () => ({
  StreamPage: () => null,
  preloadChatPanel: streamModuleMocks.preloadChatPanel,
}));

vi.mock("@/pages/History", () => {
  historyModuleMocks.loaded();
  return { HistoryPage: () => null };
});

// Guards: route chunk warming must wait for first paint, progress in bounded batches, and schedule once.
describe("primary route chunk preload", () => {
  afterEach(() => {
    streamModuleMocks.preloadChatPanel.mockReset();
    historyModuleMocks.loaded.mockReset();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("waits two frames and eventually runs every loader in bounded batches", async () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const loaders = Array.from({ length: 7 }, () => vi.fn(async () => undefined));

    const { createStagedChunkPreloader } = await import("@/pages");
    const schedule = createStagedChunkPreloader(loaders, requestFrame, {
      initialFrames: 2,
      batchSize: 3,
    });

    schedule();
    schedule();

    expect(frames).toHaveLength(1);
    expect(loaders.every((load) => load.mock.calls.length === 0)).toBe(true);

    frames.shift()?.(0);
    frames.shift()?.(16);
    expect(loaders.every((load) => load.mock.calls.length === 0)).toBe(true);

    frames.shift()?.(32);
    expect(loaders.slice(0, 3).every((load) => load.mock.calls.length === 1)).toBe(true);
    expect(loaders.slice(3).every((load) => load.mock.calls.length === 0)).toBe(true);

    await vi.waitFor(() => expect(frames).toHaveLength(1));
    frames.shift()?.(48);
    expect(loaders.slice(0, 6).every((load) => load.mock.calls.length === 1)).toBe(true);

    await vi.waitFor(() => expect(frames).toHaveLength(1));
    frames.shift()?.(64);
    expect(loaders.every((load) => load.mock.calls.length === 1)).toBe(true);

    await Promise.resolve();
    expect(frames).toHaveLength(0);
  });

  it("wires the primary preloader to one initial animation frame", async () => {
    const requestAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);

    const { schedulePrimaryPageChunkPreload } = await import("@/pages");

    schedulePrimaryPageChunkPreload();
    schedulePrimaryPageChunkPreload();

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).toHaveBeenCalledWith(expect.any(Function));
  });

  it("warms History after the first paint frame without joining the broad preload queue", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      })
    );
    const { scheduleHistoryPageChunkPreload } = await import("@/pages");

    scheduleHistoryPageChunkPreload();
    scheduleHistoryPageChunkPreload();

    expect(frames).toHaveLength(1);
    expect(historyModuleMocks.loaded).not.toHaveBeenCalled();

    frames.shift()?.(0);
    expect(frames).toHaveLength(1);
    expect(historyModuleMocks.loaded).not.toHaveBeenCalled();

    frames.shift()?.(16);
    await vi.waitFor(() => expect(historyModuleMocks.loaded).toHaveBeenCalledTimes(1));
  });

  it("renders a route synchronously after its staged preload completes", async () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    };
    const Page = () => null;

    const { createPreloadableRoute, createStagedChunkPreloader } = await import("@/pages");
    const route = createPreloadableRoute(async () => ({ default: Page }));
    const schedule = createStagedChunkPreloader([route.preload], requestFrame, {
      initialFrames: 2,
      batchSize: 1,
    });

    schedule();
    frames.shift()?.(0);
    frames.shift()?.(16);
    frames.shift()?.(32);
    await route.preload();

    expect(() => route.Component()).not.toThrow();
    expect(route.Component().type).toBe(Page);
  });

  it("lets TanStack preload the matched component before navigation without loading it twice", async () => {
    const Page = () => null;
    const load = vi.fn(async () => ({ default: Page }));
    const { createPreloadableRoute } = await import("@/pages");
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

    const { createPreloadableRoute } = await import("@/pages");
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
    const { preloadStreamPage } = await import("@/pages");

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
