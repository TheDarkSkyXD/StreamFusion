import { type ComponentType, lazy, type ReactElement } from "react";

import { createPreloadableComponent } from "./preloadable-component";

export function createPreloadableRoute(load: () => Promise<{ default: ComponentType }>) {
  const route = createPreloadableComponent(load);
  const Component = Object.assign(route.Component as () => ReactElement, {
    preload: () => route.preload().then(() => undefined),
  });
  return {
    ...route,
    Component,
  };
}

type PageChunkLoader = () => Promise<unknown>;

interface StagedChunkPreloaderOptions {
  initialFrames: number;
  batchSize: number;
}

export function createStagedChunkPreloader(
  loaders: PageChunkLoader[],
  requestFrame: typeof requestAnimationFrame,
  { initialFrames, batchSize }: StagedChunkPreloaderOptions
): () => void {
  let scheduled = false;

  return () => {
    if (scheduled) return;
    scheduled = true;

    let framesRemaining = initialFrames;
    let nextLoaderIndex = 0;
    const advance = () => {
      if (framesRemaining > 0) {
        framesRemaining -= 1;
        requestFrame(advance);
        return;
      }

      const batch = loaders.slice(nextLoaderIndex, nextLoaderIndex + batchSize);
      nextLoaderIndex += batch.length;
      const pendingBatch = batch.map((load) => {
        try {
          return load();
        } catch (error) {
          return Promise.reject(error);
        }
      });
      void Promise.allSettled(pendingBatch).then(() => {
        if (nextLoaderIndex < loaders.length) requestFrame(advance);
      });
    };

    requestFrame(advance);
  };
}

// Lazy load all page components for code splitting
// This reduces initial bundle size by ~40% as pages are loaded on-demand

export const HomePage = lazy(() => import("./Home").then((m) => ({ default: m.HomePage })));

export const FollowingPage = lazy(() =>
  import("./Following").then((m) => ({ default: m.FollowingPage }))
);

export const CategoriesPage = lazy(() =>
  import("./Categories").then((m) => ({ default: m.CategoriesPage }))
);

export const CategoryDetailPage = lazy(() =>
  import("./CategoryDetail").then((m) => ({ default: m.CategoryDetailPage }))
);

export const SearchPage = lazy(() =>
  import("./SearchResults").then((m) => ({ default: m.SearchPage }))
);

let streamPageModulePromise: Promise<typeof import("./Stream")> | undefined;
const loadStreamPageModule = () => (streamPageModulePromise ??= import("./Stream"));
const streamPageRoute = createPreloadableRoute(() =>
  loadStreamPageModule().then((module) => ({ default: module.StreamPage }))
);

export function preloadStreamPage(): Promise<void> {
  return Promise.all([
    streamPageRoute.preload(),
    loadStreamPageModule().then((module) => module.preloadChatPanel()),
  ]).then(() => undefined);
}

export const StreamPage = Object.assign(streamPageRoute.Component, {
  preload: preloadStreamPage,
});

export const SettingsPage = lazy(() =>
  import("./Settings").then((m) => ({ default: m.SettingsPage }))
);

export const VideoPage = lazy(() => import("./Video").then((m) => ({ default: m.VideoPage })));

export const MultiStreamPage = lazy(() =>
  import("./MultiStream").then((m) => ({ default: m.MultiStreamPage }))
);

export const HistoryPage = lazy(() =>
  import("./History").then((m) => ({ default: m.HistoryPage }))
);

export const DownloadsPage = lazy(() =>
  import("./Downloads").then((m) => ({ default: m.DownloadsPage }))
);

export const ModPage = lazy(() => import("./Mod").then((m) => ({ default: m.ModPage })));

export const ModChannelTwitchPage = lazy(() =>
  import("./Mod/channel/ModChannelTwitchPage").then((m) => ({
    default: m.ModChannelTwitchPage,
  }))
);

export const ModChannelKickPage = lazy(() =>
  import("./Mod/channel/ModChannelKickPage").then((m) => ({
    default: m.ModChannelKickPage,
  }))
);

const primaryPageChunkLoaders: PageChunkLoader[] = [
  () => import("./Home"),
  () => import("./Following"),
  () => import("./Categories"),
  () => import("./CategoryDetail"),
  () => import("./SearchResults"),
  preloadStreamPage,
  () => import("./Settings"),
  () => import("./Video"),
  () => import("./MultiStream"),
  () => import("./Downloads"),
  () => import("./Mod"),
  () => import("./Mod/channel/ModChannelTwitchPage"),
  () => import("./Mod/channel/ModChannelKickPage"),
];

let primaryPageChunkScheduler: (() => void) | undefined;

export function schedulePrimaryPageChunkPreload(): void {
  primaryPageChunkScheduler ??= createStagedChunkPreloader(
    primaryPageChunkLoaders,
    window.requestAnimationFrame,
    { initialFrames: 2, batchSize: 3 }
  );
  primaryPageChunkScheduler();
}

let historyPageChunkScheduler: (() => void) | undefined;

export function scheduleHistoryPageChunkPreload(): void {
  historyPageChunkScheduler ??= createStagedChunkPreloader(
    [() => import("./History")],
    window.requestAnimationFrame,
    { initialFrames: 1, batchSize: 1 }
  );
  historyPageChunkScheduler();
}
