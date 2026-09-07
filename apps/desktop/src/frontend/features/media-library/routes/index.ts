import { createPreloadableRoute } from "@/routes/preloadable-route";

export const HistoryPage = createPreloadableRoute(() =>
  import("../components/screens/History").then((module) => ({ default: module.HistoryPage }))
).Component;
export const DownloadsPage = createPreloadableRoute(() =>
  import("../components/screens/Downloads").then((module) => ({ default: module.DownloadsPage }))
).Component;
