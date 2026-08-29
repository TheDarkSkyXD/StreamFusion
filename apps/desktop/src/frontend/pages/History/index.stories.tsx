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

import { HISTORY_QUERY_KEYS } from "@/features/media-library/data/useHistoryQuery";
import type { ElectronAPI } from "@backend/preload";
import type { HistoryItem } from "@/store/history-store";
import { useHistoryStore } from "@/store/history-store";
import { usePlaybackPositionStore } from "@/store/playback-position-store";

import { HistoryPage } from "./index";

const HISTORY_TIMESTAMP = Date.UTC(2026, 7, 10, 18, 30);
const TWITCH_VIDEO_ID = "1881947598";
const KICK_VIDEO_ID = "kick-vod-2048";

function withBridgeMethods<T extends object>(section: T, methods: Partial<T>): T {
  const fixture: T = Object.create(section);
  return Object.assign(fixture, methods);
}

function svgDataUri(label: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="${color}"/><circle cx="1060" cy="120" r="260" fill="#ffffff" fill-opacity=".08"/><text x="64" y="620" fill="#ffffff" font-family="sans-serif" font-size="44" font-weight="700">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const historyFixtures: HistoryItem[] = [
  {
    id: `twitch-video-${TWITCH_VIDEO_ID}`,
    originalId: TWITCH_VIDEO_ID,
    title: "Late-night ranked climb, full VOD",
    thumbnail: svgDataUri("Ranked climb", "#33205c"),
    platform: "twitch",
    type: "video",
    channelName: "novaarcade",
    channelDisplayName: "NovaArcade",
    timestamp: HISTORY_TIMESTAMP,
  },
  {
    id: `kick-video-${KICK_VIDEO_ID}`,
    originalId: KICK_VIDEO_ID,
    title: "Building a first-playable boss encounter",
    thumbnail: svgDataUri("Boss encounter", "#183c35"),
    platform: "kick",
    type: "video",
    channelName: "framebyframe",
    channelDisplayName: "Frame by Frame",
    timestamp: HISTORY_TIMESTAMP - 3_600_000,
  },
  {
    id: "twitch-stream-novaarcade",
    originalId: "novaarcade",
    title: "NovaArcade live stream",
    thumbnail: svgDataUri("Live stream", "#46231f"),
    platform: "twitch",
    type: "stream",
    channelName: "novaarcade",
    channelDisplayName: "NovaArcade",
    timestamp: HISTORY_TIMESTAMP - 7_200_000,
  },
];

function installElectronFixture(): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const previousBridge = window.electronAPI;
  const fixture: ElectronAPI = Object.create(previousBridge);

  fixture.videos = withBridgeMethods(previousBridge.videos, {
    getPlaybackUrl: async () => ({
      success: false,
      error: "VOD unavailable in this fixture.",
    }),
  });

  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    writable: true,
    value: fixture,
  });

  return () => {
    if (previousDescriptor) {
      Object.defineProperty(window, "electronAPI", previousDescriptor);
      return;
    }
    Reflect.deleteProperty(window, "electronAPI");
  };
}

function createHistoryQueryClient(history: HistoryItem[]): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      },
    },
  });
  queryClient.setQueryData(HISTORY_QUERY_KEYS.all, history);
  return queryClient;
}

function installHistoryStores(history: HistoryItem[]): () => void {
  const previousHistoryState = useHistoryStore.getState();
  const previousPlaybackPositionState = usePlaybackPositionStore.getState();

  useHistoryStore.setState({ history });
  usePlaybackPositionStore.setState({
    positions: {
      [`twitch-${TWITCH_VIDEO_ID}`]: {
        videoId: TWITCH_VIDEO_ID,
        platform: "twitch",
        position: 2_400,
        duration: 3_600,
        lastUpdated: HISTORY_TIMESTAMP,
        title: "Late-night ranked climb, full VOD",
      },
      [`kick-${KICK_VIDEO_ID}`]: {
        videoId: KICK_VIDEO_ID,
        platform: "kick",
        position: 1_800,
        duration: 7_200,
        lastUpdated: HISTORY_TIMESTAMP,
        title: "Building a first-playable boss encounter",
      },
    },
  });

  return () => {
    usePlaybackPositionStore.setState(previousPlaybackPositionState, true);
    useHistoryStore.setState(previousHistoryState, true);
  };
}

function HistoryStoryRouter() {
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ component: Outlet });
    const historyRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/history",
      component: HistoryPage,
    });
    const streamRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/stream/$platform/$channel",
      component: () => <div>Stream route fixture</div>,
    });
    const videoRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/video/$platform/$videoId",
      component: () => <div>Video route fixture</div>,
    });

    return createRouter({
      routeTree: rootRoute.addChildren([historyRoute, streamRoute, videoRoute]),
      history: createMemoryHistory({ initialEntries: ["/history"] }),
      defaultPendingMinMs: 0,
    });
  });

  return <RouterProvider router={router} />;
}

function HistoryPageFixture({ history }: { history: HistoryItem[] }) {
  const [queryClient] = useState(() => createHistoryQueryClient(history));
  useEffect(() => () => queryClient.clear(), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-[760px] min-w-[960px] bg-[var(--color-background-primary)]">
        <HistoryStoryRouter />
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Pages/History",
  component: HistoryPage,
  beforeEach: installElectronFixture,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Watch history with an isolated Zustand store, React Query cache, memory router, and Electron bridge fixture. All populated records are videos or streams, so these stories do not open clip playback or request HLS.",
      },
    },
  },
} satisfies Meta<typeof HistoryPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PopulatedWithVodProgress: Story = {
  beforeEach: () => installHistoryStores(historyFixtures),
  render: () => <HistoryPageFixture history={historyFixtures} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Late-night ranked climb, full VOD")).toBeInTheDocument();
    await expect(canvas.getAllByRole("progressbar", { name: "Watch progress" })[0]).toHaveAttribute(
      "aria-valuenow",
      "67"
    );
  },
};

export const Empty: Story = {
  beforeEach: () => installHistoryStores([]),
  render: () => <HistoryPageFixture history={[]} />,
};

export const ClearHistoryAction: Story = {
  beforeEach: () => installHistoryStores(historyFixtures),
  render: () => <HistoryPageFixture history={historyFixtures} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const originalConfirm = window.confirm;

    try {
      window.confirm = () => true;
      await userEvent.click(canvas.getByRole("button", { name: "Clear History" }));
      await expect(canvas.getByText("No watch history yet")).toBeInTheDocument();
    } finally {
      window.confirm = originalConfirm;
    }
  },
};

export const UnavailableVodRemovesEntry: Story = {
  beforeEach: () => installHistoryStores([historyFixtures[0]]),
  render: () => <HistoryPageFixture history={[historyFixtures[0]]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Late-night ranked climb, full VOD" })
    );
    await expect(canvas.getByText("No watch history yet")).toBeInTheDocument();
  },
};
