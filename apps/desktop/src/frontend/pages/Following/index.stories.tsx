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

import type { ElectronAPI } from "@backend/preload";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";
import { usePipStore } from "@/store/pip-store";

import { FollowingPage } from "./index";
import { followedCategories, followedChannels, followedStreams } from "./story-fixtures";

type FollowingState = "populated" | "loading" | "empty" | "error";

type FollowingBridge = Pick<
  ElectronAPI,
  "categories" | "channels" | "clips" | "streams" | "videos"
>;

function neverResolves(): Promise<never> {
  return new Promise(() => undefined);
}

function withBridgeMethods<T extends object>(section: T, methods: Partial<T>): T {
  const fixture: T = Object.create(section);
  return Object.assign(fixture, methods);
}

function installFollowingMocks(state: FollowingState): () => void {
  const bridge: FollowingBridge = window.electronAPI;
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const noContent = { success: true, data: [] } satisfies { success: true; data: never[] };
  const fixture: FollowingBridge = Object.create(bridge);

  fixture.categories = withBridgeMethods(bridge.categories, {
    getTop: async () => ({
      success: true,
      data: state === "populated" ? followedCategories : [],
      providers: { twitch: "complete", kick: "complete" },
    }),
  });
  fixture.channels = withBridgeMethods(bridge.channels, {
    getByUsername: async () => ({ success: true, data: null }),
    getFollowed: async () => {
      if (state === "loading") return neverResolves();
      if (state === "error") {
        return { success: false, error: "Following is temporarily unavailable." };
      }
      return { success: true, data: state === "populated" ? followedChannels : [] };
    },
  });
  fixture.clips = withBridgeMethods(bridge.clips, {
    getByChannel: async () => noContent,
    getPlaybackUrl: async () => ({
      success: false,
      error: "Playback is disabled in Storybook.",
    }),
  });
  fixture.streams = withBridgeMethods(bridge.streams, {
    getFollowed: async () => {
      if (state === "loading") return neverResolves();
      if (state === "error") {
        return { success: false, error: "Live status is temporarily unavailable." };
      }
      return { success: true, data: state === "populated" ? followedStreams : [] };
    },
    getTop: async () => noContent,
  });
  fixture.videos = withBridgeMethods(bridge.videos, {
    getByChannel: async () => noContent,
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

function installFollowingStores(): () => void {
  const previousAuthState = useAuthStore.getState();
  const previousFollowState = useFollowStore.getState();
  const previousPipState = usePipStore.getState();

  useAuthStore.setState({
    twitchConnected: true,
    kickConnected: true,
    twitchUser: {
      id: "story-twitch",
      login: "storybook",
      displayName: "Storybook",
      profileImageUrl: "",
      createdAt: "2026-08-10T12:00:00.000Z",
      broadcasterType: "",
    },
    kickUser: {
      id: 101,
      username: "storybook",
      slug: "storybook",
      profilePic: "",
      verified: false,
    },
    followSyncInProgress: false,
    followSyncLastSyncedAt: {
      twitch: "2026-08-29T20:23:00.000-05:00",
      kick: "2026-08-29T20:23:00.000-05:00",
    },
    initialized: true,
  });
  useFollowStore.setState({
    localFollows: [],
    isHydrated: true,
    pendingAccountActions: [],
    sourceByKey: new Map(),
  });
  usePipStore.setState({ currentStream: null, isPipActive: false, isOnStreamPage: false });

  return () => {
    usePipStore.setState(previousPipState, true);
    useFollowStore.setState(previousFollowState, true);
    useAuthStore.setState(previousAuthState, true);
  };
}

function installFollowingEnvironment(state: FollowingState): () => void {
  const restoreMocks = installFollowingMocks(state);
  const restoreStores = installFollowingStores();

  return () => {
    restoreStores();
    restoreMocks();
  };
}

function createFollowingRouter() {
  const rootRoute = createRootRoute({ component: Outlet });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_app",
    component: Outlet,
  });
  const followingRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/following",
    component: FollowingPage,
  });
  const homeRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/",
    component: () => null,
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

  return createRouter({
    routeTree: rootRoute.addChildren([
      appRoute.addChildren([homeRoute, followingRoute, streamRoute, categoryRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: ["/following"] }),
    defaultPendingMinMs: 0,
  });
}

function FollowingStoryCanvas() {
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
  const [router] = useState(createFollowingRouter);

  useEffect(() => () => queryClient.clear(), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const meta = {
  title: "Pages/Following/FollowingPage",
  component: FollowingPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Merged local and remote follows in a memory router with seeded Zustand stores and deterministic Electron responses. No network, HLS, or live IPC is used.",
      },
    },
  },
} satisfies Meta<typeof FollowingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  beforeEach: () => installFollowingEnvironment("populated"),
  render: () => <FollowingStoryCanvas />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Live Now")).toBeInTheDocument();
    await expect(within(canvasElement).getByText("Lumen Lab")).toBeInTheDocument();
    await expect(
      within(canvasElement).getByLabelText("Follow synchronization status")
    ).toBeInTheDocument();
  },
};

export const KickChannels: Story = {
  beforeEach: () => installFollowingEnvironment("populated"),
  render: () => <FollowingStoryCanvas />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Kick" }));
    await userEvent.click(canvas.getByRole("button", { name: "Channels" }));
    await expect(await canvas.findByText("Harbor Hours")).toBeInTheDocument();
    await expect(canvas.queryByText("Lumen Lab")).not.toBeInTheDocument();
  },
};

export const Loading: Story = {
  beforeEach: () => installFollowingEnvironment("loading"),
  render: () => <FollowingStoryCanvas />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("status", { name: "Loading followed content" })
    ).toBeInTheDocument();
  },
};

export const Empty: Story = {
  beforeEach: () => installFollowingEnvironment("empty"),
  render: () => <FollowingStoryCanvas />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("No followed channels found")
    ).toBeInTheDocument();
  },
};

export const ErrorFallback: Story = {
  beforeEach: () => installFollowingEnvironment("error"),
  render: () => <FollowingStoryCanvas />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("alert")).toHaveTextContent(
      "Couldn't load followed channels"
    );
  },
};
