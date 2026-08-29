import { lazy } from "react";

export * from "./route-boundaries";
export * from "./stream-page";
export * from "./stream-route-preload";
import { preloadStreamPage } from "./stream-page";

export const VideoPage = lazy(() =>
  import("../../../pages/Video").then((module) => ({ default: module.VideoPage }))
);

export const playbackPageChunkLoaders = [
  preloadStreamPage,
  () => import("../../../pages/Video"),
];
