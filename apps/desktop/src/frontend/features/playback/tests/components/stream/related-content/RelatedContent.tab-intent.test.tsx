import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RelatedContent } from "@/features/playback/components/related-content/index";
import type { VideoOrClip } from "@/features/playback/components/related-content/types";

vi.mock("@/features/playback/components/related-content/VideoCard", () => ({
  VideoCard: ({ video }: { video: VideoOrClip }) => (
    <div data-testid="intent-video-card">{video.title}</div>
  ),
}));

vi.mock("@/features/playback/components/related-content/ClipCard", () => ({
  ClipCard: ({ clip }: { clip: VideoOrClip }) => (
    <div data-testid="intent-clip-card">{clip.title}</div>
  ),
}));

vi.mock("@/features/discovery/data/queries/persisted-snapshot", () => ({
  loadPersistedSnapshot: vi.fn(async () => null),
  savePersistedSnapshot: vi.fn(async () => undefined),
}));

vi.mock("@/lib/viewport-image-prewarm", () => ({
  prewarmViewportImages: vi.fn(async () => undefined),
}));

const videos = Array.from({ length: 9 }, (_, index) => ({
  id: `video-${index}`,
  title: `Video ${index}`,
  duration: "1:00",
  views: String(index),
  date: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
  thumbnailUrl: `https://cdn.test/video-${index}.jpg`,
  created_at: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
})) as VideoOrClip[];

const clips = Array.from({ length: 6 }, (_, index) => ({
  id: `clip-${index}`,
  title: `Clip ${index}`,
  duration: "0:30",
  views: String(index),
  date: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
  thumbnailUrl: `https://cdn.test/clip-${index}.jpg`,
})) as VideoOrClip[];

interface RouteGate {
  promise: Promise<void>;
  release: () => void;
}

function createRouteGate(): RouteGate {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// Guards: cached tab content renders from the click intent before a pending hash-route transition settles.
// Guards: settled and external route changes replace the local intent so back/forward navigation stays authoritative.
describe("RelatedContent tab intent", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/index.html#/stream/kick/nicklee?tab=home");
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        videos: { getByChannel: vi.fn(async () => ({ success: true, data: videos })) },
        clips: {
          getByChannel: vi.fn(async () => ({ success: true, data: clips })),
          getPlaybackUrl: vi.fn(),
        },
      },
      writable: true,
    });
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("publishes cached videos synchronously while the Videos route is still pending", async () => {
    const videosGate = createRouteGate();
    let blockVideos = false;
    const rootRoute = createRootRoute({ component: Outlet });
    const appRoute = createRoute({
      getParentRoute: () => rootRoute,
      id: "_app",
      component: Outlet,
    });
    const streamRoute = createRoute({
      getParentRoute: () => appRoute,
      path: "/stream/$platform/$channel",
      validateSearch: (search: Record<string, unknown>) => ({
        tab: typeof search.tab === "string" ? search.tab : undefined,
      }),
      beforeLoad: ({ search }) => {
        if (blockVideos && search.tab === "videos") return videosGate.promise;
      },
      component: () => (
        <RelatedContent platform="kick" channelName="nicklee" channelData={undefined} />
      ),
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([appRoute.addChildren([streamRoute])]),
      history: createHashHistory(),
    });
    await act(() => router.load());
    const view = render(<RouterProvider router={router} />);

    await waitFor(() => expect(screen.getAllByTestId("intent-video-card")).toHaveLength(4));
    blockVideos = true;

    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Videos" }));
      await Promise.resolve();
    });

    expect(router.state.location.search).toEqual({ tab: "videos" });
    expect(router.state.status).toBe("pending");
    expect(screen.getAllByTestId("intent-video-card")).toHaveLength(9);
    expect(screen.getByText("Sort by:")).toBeInTheDocument();

    videosGate.release();
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: "videos" }));

    await act(() =>
      router.navigate({
        to: "/stream/$platform/$channel",
        params: { platform: "kick", channel: "nicklee" },
        search: { tab: "clips" },
      })
    );
    expect(screen.getAllByTestId("intent-clip-card")).toHaveLength(6);
    expect(screen.getByText("Filter by:")).toBeInTheDocument();

    await act(() => router.history.back());
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: "videos" }));
    expect(screen.getAllByTestId("intent-video-card")).toHaveLength(9);
    expect(screen.queryByText("Filter by:")).not.toBeInTheDocument();

    view.unmount();
    router.history.destroy();
  });
});
