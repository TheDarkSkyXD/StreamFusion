import { createPreloadableRoute } from "@/routes/preloadable-route";

export const MultiStreamPage = createPreloadableRoute(() =>
  import("../../../pages/MultiStream").then((module) => ({ default: module.MultiStreamPage }))
).Component;
