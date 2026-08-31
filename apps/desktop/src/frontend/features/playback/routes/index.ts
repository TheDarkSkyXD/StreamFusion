import { createPreloadableRoute } from "@/routes/preloadable-route";

export * from "./route-boundaries";
export * from "./stream-page";
export * from "./stream-route-preload";

export const VideoPage = createPreloadableRoute(() =>
  import("../../../pages/Video").then((module) => ({ default: module.VideoPage }))
).Component;
