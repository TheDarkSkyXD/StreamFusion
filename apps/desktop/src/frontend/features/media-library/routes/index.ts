import { createPreloadableRoute } from "@/routes/preloadable-route";

export const HistoryPage = createPreloadableRoute(() =>
  import("../../../pages/History").then((module) => ({ default: module.HistoryPage }))
).Component;
export const DownloadsPage = createPreloadableRoute(() =>
  import("../../../pages/Downloads").then((module) => ({ default: module.DownloadsPage }))
).Component;
