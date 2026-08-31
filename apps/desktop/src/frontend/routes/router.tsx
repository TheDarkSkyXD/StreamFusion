import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import type React from "react";
import { Suspense } from "react";

import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  CategoriesPage,
  CategoryDetailPage,
  FollowingPage,
  HomePage,
  SearchPage,
  validateCategoryDetailSearch,
  validateSearchQuery,
} from "@/features/discovery/routes";
import { DownloadsPage, HistoryPage } from "@/features/media-library/routes";
import { ModChannelKickPage, ModChannelTwitchPage, ModPage } from "@/features/moderation/routes";
import { MultiStreamPage } from "@/features/multistream/routes";
import {
  StreamPage,
  VideoPage,
  validateStreamSearch,
  validateVideoSearch,
} from "@/features/playback/routes";
import { SettingsPage, validateSettingsSearch } from "@/features/settings/routes";
import { APP_SHELL_ROUTE_ID, AppLayout, RecoveryBoundary } from "@/features/shell";

const PageLoader = () => (
  <div
    role="status"
    aria-label="Loading page"
    data-route-page-loader="true"
    className="flex h-full items-center justify-center"
  >
    <LoadingSpinner size="md" className="motion-reduce:animate-none" />
  </div>
);

// Wrap lazy component with Suspense while keeping route chunk loading opt-in.
export const withSuspense = (
  Component: React.ComponentType & { preload?: () => Promise<unknown> },
  { forwardPreload = false }: { forwardPreload?: boolean } = {}
) => {
  const SuspenseComponent = () => (
    <RecoveryBoundary name="This page">
      <Suspense fallback={<PageLoader />}>
        <Component />
      </Suspense>
    </RecoveryBoundary>
  );

  return forwardPreload
    ? Object.assign(SuspenseComponent, { preload: Component.preload })
    : SuspenseComponent;
};

// Root layout (wraps everything)
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// App Layout Route (Pathless) - provides the sidebar/navbar
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: APP_SHELL_ROUTE_ID,
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
});

// Popout Route (Minimal layout)

// Home/Browse page
const homeRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  component: withSuspense(HomePage),
});

// Following page
const followingRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/following",
  component: withSuspense(FollowingPage),
});

// Categories page
const categoriesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/categories",
  component: withSuspense(CategoriesPage),
});

// Category detail page.
// `otherId` is the other-platform category id when known up-front (the merged
// list captures it during dedup so this page can fetch cross-platform streams
// without a name-based runtime search).
const categoryDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/categories/$platform/$categoryId",
  validateSearch: validateCategoryDetailSearch,
  component: withSuspense(CategoryDetailPage),
});

// Search page
const searchRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/search",
  validateSearch: validateSearchQuery,
  component: withSuspense(SearchPage),
});

// Stream viewing page
const streamRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/stream/$platform/$channel",
  validateSearch: validateStreamSearch,
  component: withSuspense(StreamPage, { forwardPreload: true }),
});

// Video viewing page (VOD)
const videoRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/video/$platform/$videoId",
  validateSearch: validateVideoSearch,
  component: withSuspense(VideoPage),
});

// Settings page
const settingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/settings",
  validateSearch: validateSettingsSearch,
  component: withSuspense(SettingsPage),
});

// MultiStream page
const multiStreamRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/multistream",
  component: withSuspense(MultiStreamPage),
});

// History page
const historyRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/history",
  component: withSuspense(HistoryPage),
});

// Downloads page
const downloadsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/downloads",
  component: withSuspense(DownloadsPage),
});

// Moderation page — top-level /mod surface. Nav-link gating happens in the
// TopNavBar (visible only when the signed-in user moderates ≥1 channel); the
// route itself is always registered so a deep-link still resolves.
const modRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/mod",
  component: withSuspense(ModPage),
});

// Per-channel mod admin pages — one per platform. The URL param is the
// broadcaster_login (Twitch) or slug (Kick); the route component resolves
// the numeric id internally (Twitch) or uses the slug directly (Kick).
const modChannelTwitchRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/mod/twitch/$channel",
  component: withSuspense(ModChannelTwitchPage),
});

const modChannelKickRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/mod/kick/$channel",
  component: withSuspense(ModChannelKickPage),
});

// Build the route tree
const routeTree = rootRoute.addChildren([
  appLayoutRoute.addChildren([
    homeRoute,
    followingRoute,
    categoriesRoute,
    categoryDetailRoute,
    searchRoute,
    streamRoute,
    videoRoute,
    settingsRoute,
    multiStreamRoute,
    historyRoute,
    downloadsRoute,
    modRoute,
    modChannelTwitchRoute,
    modChannelKickRoute,
  ]),
]);

// Create and export the router
export const router = createRouter({
  routeTree,
  history: createHashHistory(),
});

// Type declarations for type-safe routing
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
