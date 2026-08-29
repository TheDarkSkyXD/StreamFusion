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
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { expect, mocked, waitFor, within } from "storybook/test";

import type { UnifiedChannel } from "@shared/platform-types";
import { KickVodPlayer } from "@/features/playback/components/player/kick";
import { TwitchVodPlayer } from "@/features/playback/components/player/twitch";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";
import { useHistoryStore } from "@/store/history-store";

import { VideoPage } from "./index";

type VideoStoryState =
  "loading" | "ready" | "playback-error" | "metadata-unavailable" | "subscriber-only";

const FIXED_NOW_MS = Date.parse("2026-08-10T18:00:00.000Z");
const SAFE_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='48' fill='%2353fc18'/%3E%3Cpath d='M28 28h40v40H28z' fill='%230f0f0f'/%3E%3C/svg%3E";
const SAFE_THUMBNAIL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1280' height='720' viewBox='0 0 1280 720'%3E%3Crect width='1280' height='720' fill='%231a1a1a'/%3E%3Ccircle cx='640' cy='360' r='220' fill='%2353fc18' fill-opacity='.18'/%3E%3C/svg%3E";
const SAFE_PLAYBACK_URL = "data:application/vnd.apple.mpegurl,%23EXTM3U";

const kickChannel: UnifiedChannel = {
  id: "story-kick-channel-101",
  platform: "kick",
  username: "miramakes",
  displayName: "Mira Makes",
  avatarUrl: SAFE_AVATAR,
  bannerUrl: "",
  bio: "Small creative projects with a patient community.",
  isLive: false,
  isVerified: true,
  isPartner: true,
};

const twitchChannel: UnifiedChannel = {
  ...kickChannel,
  id: "story-twitch-channel-202",
  platform: "twitch",
  username: "lumenlab",
  displayName: "Lumen Lab",
  isVerified: false,
};

function metadataFor(state: VideoStoryState) {
  const isKick = state === "ready";
  const channel = isKick ? kickChannel : twitchChannel;

  return {
    id: state === "ready" ? "story-ready-vod" : "story-error-vod",
    title:
      state === "ready"
        ? "Building a tiny midnight city from start to finish"
        : "A complete studio lighting walkthrough",
    channelId: channel.id,
    channelName: channel.username,
    channelDisplayName: channel.displayName,
    channelAvatar: channel.avatarUrl,
    views: state === "ready" ? 48_200 : 7_420,
    duration: "2:14:08",
    createdAt: "2026-08-10T12:00:00.000Z",
    thumbnailUrl: SAFE_THUMBNAIL,
    description: "A deterministic Storybook VOD fixture.",
    type: "archive",
    platform: channel.platform,
    category: "Art",
    tags: ["Design", "Community"],
    language: "en",
    isMature: state === "ready",
    shareUrl:
      channel.platform === "kick"
        ? "https://kick.com/video/story-ready-vod"
        : "https://www.twitch.tv/videos/story-error-vod",
  };
}

function searchParams(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

const storyPaths: Record<VideoStoryState, string> = {
  loading: "/video/twitch/story-loading-vod",
  ready: "/video/kick/story-ready-vod",
  "playback-error": "/video/twitch/story-error-vod",
  "metadata-unavailable": `/video/twitch/story-degraded-vod?${searchParams({
    title: "Route metadata keeps this VOD useful",
    channelName: twitchChannel.username,
    channelDisplayName: twitchChannel.displayName,
    channelAvatar: SAFE_AVATAR,
    thumbnail: SAFE_THUMBNAIL,
    views: "1280",
    category: "Science & Technology",
    duration: "45:20",
    tags: JSON.stringify(["Engineering", "English"]),
    language: "en",
    shareUrl: "https://www.twitch.tv/videos/story-degraded-vod",
  })}`,
  "subscriber-only": `/video/kick/story-subscriber-vod?${searchParams({
    title: "Members-only studio archive",
    channelName: kickChannel.username,
    channelDisplayName: kickChannel.displayName,
    channelAvatar: SAFE_AVATAR,
    thumbnail: SAFE_THUMBNAIL,
    views: "620",
    category: "Art",
    duration: "1:08:11",
    isSubOnly: "true",
    tags: JSON.stringify(["Studio", "Archive"]),
    language: "en",
  })}`,
};

function neverResolves(): Promise<never> {
  return new Promise(() => undefined);
}

function InertKickVodPlayer({ className, onReady, title }: ComponentProps<typeof KickVodPlayer>) {
  const didSignalReady = useRef(false);
  useEffect(() => {
    if (didSignalReady.current) return;
    didSignalReady.current = true;
    onReady?.();
  }, [onReady]);

  return (
    <div
      role="region"
      aria-label="Kick VOD playback isolated"
      className={`grid place-items-center bg-black ${className ?? ""}`}
    >
      <div className="rounded-xl border border-[#53fc18]/40 bg-[#1a1a1a] px-6 py-4 text-center">
        <p className="font-semibold text-white">Kick VOD player isolated</p>
        <p className="mt-1 text-sm text-[#a0a0a0]">{title}</p>
      </div>
    </div>
  );
}

function InertTwitchVodPlayer({
  className,
  onReady,
  title,
}: ComponentProps<typeof TwitchVodPlayer>) {
  const didSignalReady = useRef(false);
  useEffect(() => {
    if (didSignalReady.current) return;
    didSignalReady.current = true;
    onReady?.();
  }, [onReady]);

  return (
    <div
      role="region"
      aria-label="Twitch VOD playback isolated"
      className={`grid place-items-center bg-black ${className ?? ""}`}
    >
      <div className="rounded-xl border border-[#9146ff]/40 bg-[#1a1a1a] px-6 py-4 text-center">
        <p className="font-semibold text-white">Twitch VOD player isolated</p>
        <p className="mt-1 text-sm text-[#a0a0a0]">{title}</p>
      </div>
    </div>
  );
}

function installStoryEnvironment(state: VideoStoryState): () => void {
  const originalBridge = window.electronAPI;
  const originalDate = globalThis.Date;
  const originalAuth = useAuthStore.getState();
  const originalFollows = useFollowStore.getState();
  const originalHistory = useHistoryStore.getState();
  const kickPlayerMock = mocked(KickVodPlayer);
  const twitchPlayerMock = mocked(TwitchVodPlayer);

  class FixedStoryDate extends originalDate {
    constructor(value?: string | number | Date) {
      super(
        value === undefined ? FIXED_NOW_MS : value instanceof originalDate ? value.getTime() : value
      );
    }

    static now() {
      return FIXED_NOW_MS;
    }
  }

  Reflect.defineProperty(globalThis, "Date", {
    configurable: true,
    writable: true,
    value: FixedStoryDate,
  });
  kickPlayerMock.mockImplementation(InertKickVodPlayer);
  twitchPlayerMock.mockImplementation(InertTwitchVodPlayer);

  Reflect.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      videos: {
        getPlaybackUrl: async () => {
          if (state === "loading") return neverResolves();
          if (state === "playback-error") {
            return { success: false, error: "This VOD is temporarily unavailable." };
          }
          return {
            success: true,
            data: { url: SAFE_PLAYBACK_URL, format: "hls" },
          };
        },
        getMetadata: async () => {
          if (state === "loading") return neverResolves();
          if (state === "metadata-unavailable") {
            return { success: false, error: "Detailed VOD metadata is unavailable." };
          }
          return { success: true, data: metadataFor(state) };
        },
        getByChannel: async () => ({ success: true, data: [], cursor: undefined }),
      },
      channels: {
        getByUsername: async ({ platform }: { platform: "twitch" | "kick" }) => ({
          data: platform === "kick" ? kickChannel : twitchChannel,
        }),
      },
      streams: {
        getByChannel: async () => ({ success: true, data: null }),
      },
      downloads: {
        getQueue: async () => ({ jobs: [] }),
        downloadVideo: async () => ({
          success: false,
          error: "Downloads are disabled in Storybook.",
        }),
      },
    },
  });

  useAuthStore.setState({ twitchUser: null, kickUser: null });
  useFollowStore.setState({
    localFollows: [],
    isHydrated: true,
    pendingAccountActions: [],
    sourceByKey: new Map(),
  });
  useHistoryStore.setState({ history: [] });

  return () => {
    useHistoryStore.setState(originalHistory, true);
    useFollowStore.setState(originalFollows);
    useAuthStore.setState(originalAuth);
    Reflect.defineProperty(window, "electronAPI", {
      configurable: true,
      value: originalBridge,
    });
    kickPlayerMock.mockRestore();
    twitchPlayerMock.mockRestore();
    Reflect.defineProperty(globalThis, "Date", {
      configurable: true,
      writable: true,
      value: originalDate,
    });
  };
}

function validateVideoSearch(search: Record<string, unknown>) {
  return {
    src: (search.src as string) || undefined,
    title: (search.title as string) || undefined,
    channelName: (search.channelName as string) || undefined,
    channelDisplayName: (search.channelDisplayName as string) || undefined,
    channelAvatar: (search.channelAvatar as string) || undefined,
    thumbnail: (search.thumbnail as string) || undefined,
    views: (search.views as string) || undefined,
    date: (search.date as string) || undefined,
    category: (search.category as string) || undefined,
    duration: (search.duration as string) || undefined,
    isSubOnly: search.isSubOnly === true || search.isSubOnly === "true" || undefined,
    tags: (search.tags as string[]) || undefined,
    language: (search.language as string) || undefined,
    isMature: search.isMature === true || search.isMature === "true" || undefined,
    shareUrl: (search.shareUrl as string) || undefined,
  };
}

function createVideoRouter(state: VideoStoryState) {
  const rootRoute = createRootRoute({ component: Outlet });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_app",
    component: Outlet,
  });
  const videoRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/video/$platform/$videoId",
    validateSearch: validateVideoSearch,
    component: () => (
      <div className="h-[52rem] min-w-[72rem] overflow-hidden bg-[var(--color-background)]">
        <VideoPage />
      </div>
    ),
  });
  const streamRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/stream/$platform/$channel",
    validateSearch: (search: Record<string, unknown>) => ({
      tab: typeof search.tab === "string" ? search.tab : undefined,
    }),
    component: () => null,
  });

  return createRouter({
    routeTree: rootRoute.addChildren([appRoute.addChildren([videoRoute, streamRoute])]),
    history: createMemoryHistory({ initialEntries: [storyPaths[state]] }),
    defaultPendingMinMs: 0,
  });
}

function VideoStoryCanvas({ state }: { state: VideoStoryState }) {
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
  const [router] = useState(() => createVideoRouter(state));

  useEffect(() => () => queryClient.clear(), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const meta = {
  title: "Pages/Video/VideoPage",
  component: VideoPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The VOD route in a route-faithful memory router with fixed time, isolated query and Zustand state, deterministic Electron responses, and temporary inert player spies. No story starts HLS, media, network, chat, or real IPC.",
      },
    },
  },
} satisfies Meta<typeof VideoPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  beforeEach: () => installStoryEnvironment("loading"),
  render: () => <VideoStoryCanvas state="loading" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Loading VOD...")).toBeInTheDocument();
  },
};

export const ReadyWithRichMetadata: Story = {
  beforeEach: () => installStoryEnvironment("ready"),
  render: () => <VideoStoryCanvas state="ready" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("region", { name: "Kick VOD playback isolated" })
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", {
        name: "Building a tiny midnight city from start to finish",
      })
    ).toBeInTheDocument();
    await expect(canvas.getByText("Today")).toBeInTheDocument();
    await expect(canvas.getByText("English")).toBeInTheDocument();
    await expect(canvas.getByText("18+")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Share" })).toBeEnabled();
    await expect(canvas.getByRole("button", { name: "Download" })).toBeEnabled();
    await expect(canvas.queryByRole("link", { name: "Watch Live" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(useHistoryStore.getState().history[0]?.title).toBe(
        "Building a tiny midnight city from start to finish"
      );
    });
  },
};

export const PlaybackErrorWithMetadata: Story = {
  beforeEach: () => installStoryEnvironment("playback-error"),
  render: () => <VideoStoryCanvas state="playback-error" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("This VOD is temporarily unavailable.")
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { name: "A complete studio lighting walkthrough" })
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Download" })).toBeDisabled();
  },
};

export const MetadataUnavailableButPlayable: Story = {
  beforeEach: () => installStoryEnvironment("metadata-unavailable"),
  render: () => <VideoStoryCanvas state="metadata-unavailable" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("region", { name: "Twitch VOD playback isolated" })
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { name: "Route metadata keeps this VOD useful" })
    ).toBeInTheDocument();
    await expect(await canvas.findByRole("button", { name: "Retry details" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Share" })).toBeEnabled();
  },
};

export const SubscriberOnly: Story = {
  beforeEach: () => installStoryEnvironment("subscriber-only"),
  render: () => <VideoStoryCanvas state="subscriber-only" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Subscriber Only VOD")).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { name: "Members-only studio archive" })
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Download" })).toBeDisabled();
  },
};
