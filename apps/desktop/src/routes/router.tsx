import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import type React from "react";
import { Suspense } from "react";

import { AppLayout } from "@/components/layout/AppLayout";
import {
  CategoriesPage,
  CategoryDetailPage,
  ClipPage,
  DownloadsPage,
  FollowingPage,
  HistoryPage,
  HomePage,
  ModChannelKickPage,
  ModChannelTwitchPage,
  ModPage,
  MultiStreamPage,
  SearchPage,
  SettingsPage,
  StreamPage,
  VideoPage,
} from "@/pages";

// Loading fallback for lazy-loaded pages
const PageLoader = () => (
  <div className="flex items-center justify-center h-full">
    <div className="w-8 h-8 border-2 border-storm-accent border-t-transparent rounded-full animate-spin" />
  </div>
);

// Wrap lazy component with Suspense
const withSuspense = (Component: React.ComponentType) => () => (
  <Suspense fallback={<PageLoader />}>
    <Component />
  </Suspense>
);

// Root layout (wraps everything)
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// App Layout Route (Pathless) - provides the sidebar/navbar
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_app",
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
  validateSearch: (search: Record<string, unknown>): { otherId?: string } => ({
    otherId: typeof search.otherId === "string" ? search.otherId : undefined,
  }),
  component: withSuspense(CategoryDetailPage),
});

// Search page
const searchRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/search",
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string) || "",
  }),
  component: withSuspense(SearchPage),
});

// Stream viewing page
const streamRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/stream/$platform/$channel",
  validateSearch: (search: Record<string, unknown>): { tab?: "home" | "videos" | "clips" } => {
    const tab = search.tab;
    return tab === "home" || tab === "videos" || tab === "clips" ? { tab } : {};
  },
  component: withSuspense(StreamPage),
});

// Video viewing page (VOD)
const videoRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/video/$platform/$videoId",
  validateSearch: (
    search: Record<string, unknown>
  ): {
    src?: string;
    title?: string;
    channelName?: string;
    channelDisplayName?: string;
    channelAvatar?: string;
    views?: string;
    date?: string;
    category?: string;
    duration?: string;
    isSubOnly?: boolean;
    tags?: string[];
    language?: string;
    isMature?: boolean;
  } => ({
    src: (search.src as string) || undefined, // Direct HLS URL (for Kick VODs)
    title: (search.title as string) || undefined,
    channelName: (search.channelName as string) || undefined,
    channelDisplayName: (search.channelDisplayName as string) || undefined,
    channelAvatar: (search.channelAvatar as string) || undefined,
    views: (search.views as string) || undefined,
    date: (search.date as string) || undefined,
    category: (search.category as string) || undefined,
    duration: (search.duration as string) || undefined,
    isSubOnly: search.isSubOnly === true || search.isSubOnly === "true" || undefined,
    tags: (search.tags as string[]) || undefined,
    language: (search.language as string) || undefined,
    isMature: search.isMature === true || search.isMature === "true" || undefined,
  }),
  component: withSuspense(VideoPage),
});

// Clip viewing page
const clipRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/clip/$platform/$clipId",
  component: withSuspense(ClipPage),
});

// Settings page
const settingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/settings",
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
    clipRoute,
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
