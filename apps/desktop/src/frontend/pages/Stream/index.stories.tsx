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
import { expect, mocked, within } from "storybook/test";

import type { UnifiedChannel, UnifiedStream } from "@shared/platform-types";
import { KickLivePlayer } from "@/features/playback/components/player/kick/kick-live-player";
import { PersistentPlayerShell } from "@/features/playback/components/player/persistent-player-shell";
import { TwitchLivePlayer } from "@/features/playback/components/player/twitch/twitch-live-player";
import { DEFAULT_USER_PREFERENCES } from "@shared/auth-types";
import { useAppStore } from "@/store/app-store";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";
import { usePipStore } from "@/store/pip-store";

import { StreamPage } from "./index";

type StreamStoryState = "loading" | "ready" | "offline" | "status-unavailable";

const SAFE_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='48' fill='%239146ff'/%3E%3Cpath d='M29 27h38v34L55 73H43V61H29z' fill='white'/%3E%3C/svg%3E";
const SAFE_BANNER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1280' height='720' viewBox='0 0 1280 720'%3E%3Crect width='1280' height='720' fill='%2318181b'/%3E%3Ccircle cx='640' cy='360' r='230' fill='%239146ff' fill-opacity='.24'/%3E%3C/svg%3E";
const SAFE_PLAYBACK_URL = "data:application/vnd.apple.mpegurl,%23EXTM3U";

const readyChannel: UnifiedChannel = {
  id: "story-channel-lumenlab",
  platform: "twitch",
  username: "lumenlab",
  displayName: "Lumen Lab",
  avatarUrl: SAFE_AVATAR,
  bannerUrl: SAFE_BANNER,
  bio: "A quiet studio for design, illustration, and community builds.",
  isLive: true,
  isVerified: true,
  isPartner: true,
};

const readyStream: UnifiedStream = {
  // An empty id deliberately keeps StreamRecordingControl outside the story tree.
  id: "",
  platform: "twitch",
  channelId: readyChannel.id,
  channelName: readyChannel.username,
  channelDisplayName: readyChannel.displayName,
  channelAvatar: SAFE_AVATAR,
  title: "Designing a calm midnight city with chat",
  viewerCount: 12_480,
  thumbnailUrl: SAFE_BANNER,
  isLive: true,
  language: "en",
  tags: ["Design", "Community"],
  categoryId: "story-category-art",
  categoryName: "Art",
  startedAt: "2026-08-10T18:00:00.000Z",
};

const offlineChannel: UnifiedChannel = {
  ...readyChannel,
  id: "story-channel-quietchannel",
  username: "quietchannel",
  displayName: "Quiet Channel",
  isLive: false,
  lastStreamTitle: "Sketchbook review and studio questions",
  categoryId: "story-category-art",
  categoryName: "Art",
};

const unavailableChannel: UnifiedChannel = {
  ...readyChannel,
  id: "story-channel-status-lab",
  username: "statuslab",
  displayName: "Status Lab",
  isLive: false,
};

const storyPaths: Record<StreamStoryState, string> = {
  loading: "/stream/twitch/loading-studio",
  ready: "/stream/twitch/lumenlab",
  offline: "/stream/twitch/quietchannel",
  "status-unavailable": "/stream/twitch/statuslab",
};

function neverResolves(): Promise<never> {
  return new Promise(() => undefined);
}

function installStoryEnvironment(state: StreamStoryState): () => void {
  const originalBridgeDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const originalAuth = useAuthStore.getState();
  const originalApp = useAppStore.getState();
  const originalFollows = useFollowStore.getState();
  const originalPip = usePipStore.getState();
  const kickPlayerMock = mocked(KickLivePlayer);
  const twitchPlayerMock = mocked(TwitchLivePlayer);
  const channelForState =
    state === "ready" ? readyChannel : state === "offline" ? offlineChannel : unavailableChannel;

  kickPlayerMock.mockClear();
  twitchPlayerMock.mockClear();
  kickPlayerMock.mockImplementation(() => null);
  twitchPlayerMock.mockImplementation(() => null);

  Reflect.defineProperty(window, "electronAPI", {
    configurable: true,
    writable: true,
    value: {
      channels: {
        getByUsername: async () => {
          if (state === "loading") return neverResolves();
          return { data: channelForState };
        },
      },
      streams: {
        getByChannel: async () => {
          if (state === "loading") return neverResolves();
          if (state === "status-unavailable") {
            return { error: "Live status is temporarily unavailable." };
          }
          return { data: state === "ready" ? readyStream : null };
        },
        getPlaybackUrl: async () =>
          state === "ready"
            ? { success: true, data: { url: SAFE_PLAYBACK_URL, format: "hls" } }
            : { success: false, error: "Playback is disabled in this Storybook fixture." },
      },
      categories: {
        search: async () => ({ success: true, data: [] }),
      },
      videos: {
        getByChannel: async () => ({ success: true, data: [], cursor: undefined }),
      },
      clips: {
        getByChannel: async () => ({ success: true, data: [], cursor: undefined }),
        getPlaybackUrl: async () => ({
          success: false,
          error: "Clip playback is disabled in Storybook.",
        }),
      },
    },
  });

  useAuthStore.setState({
    preferences: {
      ...DEFAULT_USER_PREFERENCES,
      chat: { ...DEFAULT_USER_PREFERENCES.chat, position: "hidden" },
      chatDisplay: { ...DEFAULT_USER_PREFERENCES.chatDisplay },
    },
    twitchUser: null,
    kickUser: null,
  });
  useAppStore.setState({ isTheaterModeActive: false });
  useFollowStore.setState({
    localFollows: [],
    isHydrated: true,
    pendingAccountActions: [],
    sourceByKey: new Map(),
  });
  usePipStore.setState({ currentStream: null, isPipActive: false, isOnStreamPage: false });

  return () => {
    usePipStore.setState(originalPip, true);
    useFollowStore.setState(originalFollows, true);
    useAppStore.setState(originalApp, true);
    useAuthStore.setState(originalAuth, true);
    if (originalBridgeDescriptor) {
      Object.defineProperty(window, "electronAPI", originalBridgeDescriptor);
    } else {
      Reflect.deleteProperty(window, "electronAPI");
    }
    twitchPlayerMock.mockRestore();
    kickPlayerMock.mockRestore();
  };
}

function createStreamRouter(state: StreamStoryState) {
  const rootRoute = createRootRoute({ component: Outlet });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_app",
    component: Outlet,
  });
  const streamRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/stream/$platform/$channel",
    validateSearch: (search: Record<string, unknown>): { tab?: "home" | "videos" | "clips" } => {
      const tab = search.tab;
      return tab === "home" || tab === "videos" || tab === "clips" ? { tab } : {};
    },
    component: () => (
      <div className="relative h-[52rem] min-w-[72rem] overflow-hidden bg-[var(--color-background)]">
        <PersistentPlayerShell>
          <StreamPage />
        </PersistentPlayerShell>
        {state === "ready" && (
          <div
            role="img"
            aria-label="Playback isolated for Storybook"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 grid aspect-video place-items-center bg-black"
          >
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-6 py-4 text-center">
              <p className="font-semibold text-[var(--color-foreground)]">Live playback isolated</p>
              <p className="mt-1 text-sm text-[var(--color-foreground-muted)]">
                The production player boundary is intentionally inactive in Storybook.
              </p>
            </div>
          </div>
        )}
      </div>
    ),
  });
  const categoryRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/categories/$platform/$categoryId",
    validateSearch: (search: Record<string, unknown>) => ({
      otherId: typeof search.otherId === "string" ? search.otherId : undefined,
    }),
    component: () => null,
  });
  const videoRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/video/$platform/$videoId",
    component: () => null,
  });

  return createRouter({
    routeTree: rootRoute.addChildren([
      appRoute.addChildren([streamRoute, categoryRoute, videoRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: [storyPaths[state]] }),
    defaultPendingMinMs: 0,
  });
}

function StreamStoryCanvas({ state }: { state: StreamStoryState }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: Number.POSITIVE_INFINITY,
            refetchOnMount: false,
            refetchOnReconnect: false,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: false },
        },
      })
  );
  const [router] = useState(() => createStreamRouter(state));

  useEffect(() => () => queryClient.clear(), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const meta = {
  title: "Pages/Stream/StreamPage",
  component: StreamPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The live stream route in a route-faithful memory router with isolated query, Electron, and Zustand fixtures. The persistent-player boundary is present, chat is hidden, recording is omitted, and all media uses data URIs, so no HLS, media, chat, network, or real IPC can start.",
      },
    },
  },
} satisfies Meta<typeof StreamPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  beforeEach: () => installStoryEnvironment("loading"),
  render: () => <StreamStoryCanvas state="loading" />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".animate-spin")).toBeInTheDocument();
  },
};

export const ReadyWithMetadata: Story = {
  beforeEach: () => installStoryEnvironment("ready"),
  render: () => <StreamStoryCanvas state="ready" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("Designing a calm midnight city with chat")
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("img", { name: "Playback isolated for Storybook" })
    ).toBeInTheDocument();
    await expect(mocked(KickLivePlayer)).not.toHaveBeenCalled();
    await expect(mocked(TwitchLivePlayer)).not.toHaveBeenCalled();
  },
};

export const Offline: Story = {
  beforeEach: () => installStoryEnvironment("offline"),
  render: () => <StreamStoryCanvas state="offline" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Quiet Channel")).toBeInTheDocument();
    await expect(canvas.getByText("is currently offline")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Check Again" })).toBeInTheDocument();
  },
};

export const StreamStatusUnavailable: Story = {
  beforeEach: () => installStoryEnvironment("status-unavailable"),
  render: () => <StreamStoryCanvas state="status-unavailable" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Unable to check stream status")).toBeInTheDocument();
    await expect(canvas.getByText("Status Lab")).toBeInTheDocument();
  },
};
