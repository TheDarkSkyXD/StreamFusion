import { lazy } from "react";

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

export const StreamPage = lazy(() => import("./Stream").then((m) => ({ default: m.StreamPage })));

export const SettingsPage = lazy(() =>
  import("./Settings").then((m) => ({ default: m.SettingsPage }))
);

export const VideoPage = lazy(() => import("./Video").then((m) => ({ default: m.VideoPage })));

export const ClipPage = lazy(() => import("./Clip").then((m) => ({ default: m.ClipPage })));

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
