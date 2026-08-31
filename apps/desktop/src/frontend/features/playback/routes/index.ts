import { lazy } from "react";

export * from "./route-boundaries";
export * from "./stream-page";
export * from "./stream-route-preload";

export const VideoPage = lazy(() =>
  import("../../../pages/Video").then((module) => ({ default: module.VideoPage }))
);
