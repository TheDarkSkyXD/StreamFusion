import { createPreloadableRoute } from "@/routes/preloadable-route";

export const MultiStreamPage = createPreloadableRoute(() =>
  import("../components/screens/MultiStream").then((module) => ({ default: module.MultiStreamPage }))
).Component;
