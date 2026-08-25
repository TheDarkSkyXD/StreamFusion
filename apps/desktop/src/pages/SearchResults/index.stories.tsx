import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { SearchPage } from "./index";
import { populatedSearchResults, searchChannels } from "./story-fixtures";

type SearchState = "populated" | "loading" | "empty";

function neverResolves(): Promise<never> {
  return new Promise(() => undefined);
}

function installSearchMocks(state: SearchState): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const previousBridge = window.electronAPI;
  const data =
    state === "populated"
      ? populatedSearchResults
      : { channels: [], streams: [], categories: [], videos: [], clips: [] };

  const searchOverrides: typeof previousBridge.search = {
    channels: async ({ platform }) => {
      if (state === "loading") return neverResolves();

      return {
        success: true,
        data: data.channels.filter((channel) => !platform || channel.platform === platform),
        cursor: undefined,
      };
    },
    all: async ({ platform }) => {
      if (state === "loading") return neverResolves();

      return {
        success: true,
        data: {
          channels: data.channels.filter((channel) => !platform || channel.platform === platform),
          streams: data.streams.filter((stream) => !platform || stream.platform === platform),
          categories: data.categories.filter(
            (category) => !platform || category.platform === platform
          ),
          videos: data.videos.filter((video) => !platform || video.platform === platform),
          clips: data.clips.filter((clip) => !platform || clip.platform === platform),
        },
        providers: platform ? { [platform]: "complete" } : { twitch: "complete", kick: "complete" },
      };
    },
    streams: async ({ sessionId, platform }) => ({
      success: true,
      sessionId,
      platform,
      data: data.streams.filter((stream) => stream.platform === platform),
      retryable: false,
      error: null,
      scannedPages: 1,
      requestCount: 1,
    }),
    videos: async ({ sessionId, platform }) => ({
      success: true,
      sessionId,
      platform,
      data: data.videos.filter((video) => video.platform === platform),
      retryable: false,
      error: null,
      requestCount: 1,
      matchedChannelCount: 1,
    }),
    clips: async ({ sessionId, platform }) => ({
      success: true,
      sessionId,
      platform,
      data: data.clips.filter((clip) => clip.platform === platform),
      retryable: false,
      error: null,
      requestCount: 1,
      matchedChannelCount: 1,
    }),
    cancelSession: async () => ({ success: true, cancelled: true }),
    cancel: async () => ({ success: true, cancelled: true }),
  };
  const search = Object.assign(
    Object.create(previousBridge.search),
    searchOverrides
  ) as typeof previousBridge.search;
  const clips = Object.assign(Object.create(previousBridge.clips), {
    getPlaybackUrl: async () => ({
      success: false,
      error: "Clip playback is disabled in Storybook.",
    }),
  }) as typeof previousBridge.clips;
  const bridge = Object.create(previousBridge) as typeof previousBridge;

  Object.defineProperties(bridge, {
    clips: { configurable: true, value: clips },
    search: { configurable: true, value: search },
  });
  Object.defineProperty(window, "electronAPI", { configurable: true, value: bridge });

  return () => {
    if (previousDescriptor) Object.defineProperty(window, "electronAPI", previousDescriptor);
    else Reflect.deleteProperty(window, "electronAPI");
  };
}

function createSearchRouter() {
  const rootRoute = createRootRoute({ component: Outlet });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_app",
    component: Outlet,
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
    component: () => null,
  });
  const categoryRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/categories/$platform/$categoryId",
    component: () => null,
  });
  const videoRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/video/$platform/$videoId",
    component: () => null,
  });

  return createRouter({
    routeTree: rootRoute.addChildren([
      appRoute.addChildren([searchRoute, streamRoute, categoryRoute, videoRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: ["/search?q=streamfusion"] }),
    defaultPendingMinMs: 0,
  });
}

function SearchStoryCanvas() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnMount: false,
            refetchOnReconnect: false,
            refetchOnWindowFocus: false,
          },
        },
      })
  );
  const [router] = useState(createSearchRouter);

  useEffect(
    () => () => {
      queryClient.clear();
    },
    [queryClient]
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const meta = {
  title: "Pages/SearchResults/SearchPage",
  component: SearchPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Cross-platform search in a memory router with deterministic Electron responses and data-URI media. No network, HLS, or live IPC is used.",
      },
    },
  },
} satisfies Meta<typeof SearchPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  beforeEach: () => installSearchMocks("populated"),
  render: () => <SearchStoryCanvas />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Best Matches")).toBeInTheDocument();
    await expect(
      within(canvasElement).getByText(searchChannels[0].displayName)
    ).toBeInTheDocument();
  },
};

export const TwitchLiveOnly: Story = {
  beforeEach: () => installSearchMocks("populated"),
  render: () => <SearchStoryCanvas />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "TWITCH" }));
    await userEvent.click(canvas.getByRole("button", { name: "LIVE ONLY" }));
    await expect(await canvas.findByText("StreamFusion")).toBeInTheDocument();
    await expect(canvas.queryByText("Pixel Harbor")).not.toBeInTheDocument();
  },
};

export const Loading: Story = {
  beforeEach: () => installSearchMocks("loading"),
  render: () => <SearchStoryCanvas />,
};

export const Empty: Story = {
  beforeEach: () => installSearchMocks("empty"),
  render: () => <SearchStoryCanvas />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('No results found for "streamfusion"')
    ).toBeInTheDocument();
  },
};
