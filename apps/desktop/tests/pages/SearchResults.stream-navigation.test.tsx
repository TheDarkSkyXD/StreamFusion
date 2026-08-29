import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fixtures, renderWithProviders, screen, waitFor } from "../test-utils";

vi.mock("@/features/discovery/data/queries/useSearch", () => ({
  useSearchAll: vi.fn(),
  useSearchCategories: vi.fn(() => ({ data: { pages: [] }, isLoading: false })),
  useSearchChannels: vi.fn(),
  useSearchClips: vi.fn(() => ({ data: [], isLoading: false })),
  useSearchStreams: vi.fn(),
  useSearchVideos: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock("@/components/ui/proxied-image", () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

import { useSearchAll, useSearchChannels, useSearchStreams } from "@/features/discovery/data/queries/useSearch";
import { SearchPage } from "@/pages/SearchResults";

const useSearchAllMock = vi.mocked(useSearchAll);
const useSearchChannelsMock = vi.mocked(useSearchChannels);
const useSearchStreamsMock = vi.mocked(useSearchStreams);

function mockChannelSearchResults(channels: unknown[]) {
  useSearchChannelsMock.mockReturnValue({
    data: { pages: [{ data: channels }] },
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  } as unknown as ReturnType<typeof useSearchChannels>);
}

async function renderSearchPage() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_app",
    component: () => <Outlet />,
  });
  const searchRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/search",
    validateSearch: (search: Record<string, unknown>) => ({
      q: typeof search.q === "string" ? search.q : "",
    }),
    component: SearchPage,
  });
  const streamRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/stream/$platform/$channel",
    validateSearch: (search: Record<string, unknown>) => ({
      tab:
        search.tab === "home" || search.tab === "videos" || search.tab === "clips"
          ? search.tab
          : undefined,
    }),
    component: () => <div>Watching selected stream</div>,
  });
  const history = createMemoryHistory({ initialEntries: ["/search?q=streamer%20univer"] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([appRoute.addChildren([searchRoute, streamRoute])]),
    history,
  });

  await act(async () => {
    await router.load();
  });

  return { history, router, view: renderWithProviders(<RouterProvider router={router} />) };
}

// Guards: a complete fuzzy Stream result remains clickable through the real StreamGrid and StreamCard route surface
// Guards: malformed Stream data never creates an undefined watch route or placeholder Stream card
// Guards: malformed cached Channel data never creates an undefined watch route or crashes result rendering
// Guards: the renderer preserves backend-approved multi-token Channel matches instead of applying a stricter whole-query filter
describe("SearchPage Stream navigation", () => {
  beforeEach(() => {
    mockChannelSearchResults([]);
  });

  it("opens the real watch route and gives malformed Streams no navigation target", async () => {
    const validStream = fixtures.stream({
      id: "real-stream",
      platform: "kick",
      channelName: "streamer_universe",
      channelDisplayName: "Streamer Universe",
      title: "Streamer Universe Live",
    });
    const malformedStream = {
      ...validStream,
      id: "malformed-stream",
      channelName: undefined,
      title: "Malformed Stream",
    };
    useSearchAllMock.mockReturnValue({
      data: {
        channels: [],
        streams: [malformedStream, validStream],
        videos: [],
        clips: [],
        categories: [],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    useSearchStreamsMock.mockReturnValue({
      data: [malformedStream, validStream],
      platformStates: {},
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      limitReached: false,
      isFinalEmpty: false,
      retryPlatform: vi.fn(),
      isRetrying: false,
    } as unknown as ReturnType<typeof useSearchStreams>);

    const { history, router, view } = await renderSearchPage();

    expect(document.querySelector('a[href*="undefined"]')).not.toBeInTheDocument();
    expect(screen.queryByText("Malformed Stream")).not.toBeInTheDocument();

    const validLink = screen.getAllByText("Streamer Universe Live")[0].closest("a");
    await act(async () => {
      validLink?.click();
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/stream/kick/streamer_universe");
      expect(router.state.location.search).toEqual({ tab: "home" });
      expect(screen.getByText("Watching selected stream")).toBeInTheDocument();
    });
    view.unmount();
    history.destroy();
  });

  it("renders an approved Channel whose query tokens match across identity fields", async () => {
    const channel = fixtures.channel({
      id: "cross-field-match",
      username: "streamer",
      displayName: "The Universe",
    });
    useSearchAllMock.mockReturnValue({
      data: {
        channels: [channel],
        streams: [],
        videos: [],
        clips: [],
        categories: [],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    mockChannelSearchResults([channel]);

    const { history, view } = await renderSearchPage();

    expect(screen.getAllByText("The Universe").length).toBeGreaterThan(0);
    view.unmount();
    history.destroy();
  });

  it("rejects a malformed cached Channel before building its watch route", async () => {
    const validChannel = fixtures.channel({
      id: "valid-channel",
      platform: "twitch",
      username: "streamer_universe",
      displayName: "Streamer Universe",
    });
    useSearchAllMock.mockReturnValue({
      data: {
        channels: [{ ...validChannel, id: "malformed-channel", username: undefined }, validChannel],
        streams: [],
        videos: [],
        clips: [],
        categories: [],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    mockChannelSearchResults([
      { ...validChannel, id: "malformed-channel", username: undefined },
      validChannel,
    ]);

    const { history, view } = await renderSearchPage();

    expect(document.querySelector('a[href*="undefined"]')).not.toBeInTheDocument();
    const validLink = screen.getAllByText("Streamer Universe")[0].closest("a");
    expect(validLink).toHaveAttribute("href", "/stream/twitch/streamer_universe?tab=home");
    view.unmount();
    history.destroy();
  });
});
