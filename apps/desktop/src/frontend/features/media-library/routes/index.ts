import { lazy } from "react";

export const HistoryPage = lazy(() =>
  import("../../../pages/History").then((module) => ({ default: module.HistoryPage }))
);
export const DownloadsPage = lazy(() =>
  import("../../../pages/Downloads").then((module) => ({ default: module.DownloadsPage }))
);

export const mediaLibraryPrimaryPageChunkLoaders = [() => import("../../../pages/Downloads")];
export const historyPageChunkLoaders = [() => import("../../../pages/History")];
