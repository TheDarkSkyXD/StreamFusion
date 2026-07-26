import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CHANNEL_KEYS } from "@/hooks/queries/useChannels";
import { STREAM_KEYS } from "@/hooks/queries/useStreams";
import { useAppStore } from "@/store/app-store";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";
import { usePipStore } from "@/store/pip-store";

import { makeChannel, makeStream } from "../../../.storybook/catalog-fixtures";
import { withAppRouter } from "../../../.storybook/story-router";
import { AppLayout } from "./AppLayout";

const followedChannels = Array.from({ length: 7 }, (_, index) => {
  const platform = index % 3 === 1 ? "kick" : "twitch";
  return makeChannel(index, {
    id: `${platform}-shell-channel-${index + 1}`,
    platform,
    username: `shellchannel${index + 1}`,
    displayName: ["Nova Arcade", "Pixel Nomad", "Mira Makes", "Rift Runner"][index % 4],
    avatarUrl: "",
    isLive: index < 4,
  });
});

const liveStreams = followedChannels.slice(0, 4).map((channel, index) =>
  makeStream(index, {
    id: `${channel.platform}-shell-stream-${index + 1}`,
    platform: channel.platform,
    channelId: channel.id,
    channelName: channel.username,
    channelDisplayName: channel.displayName,
    channelAvatar: "",
    thumbnailUrl: "",
    viewerCount: 38_400 - index * 7_200,
  })
);

function withShellState({
  collapsed = false,
  theater = false,
}: {
  collapsed?: boolean;
  theater?: boolean;
} = {}): Decorator {
  return (Story) => {
    useAppStore.setState({
      sidebarCollapsed: collapsed,
      userPrefersSidebarCollapsed: collapsed,
      isTheaterModeActive: theater,
    });
    useAuthStore.setState({
      twitchConnected: false,
      kickConnected: false,
      twitchUser: null,
      kickUser: null,
      isGuest: true,
      initialized: true,
    });
    useFollowStore.setState({
      localFollows: followedChannels,
      sourceByKey: new Map(
        followedChannels.map((channel) => [`${channel.platform}:${channel.id}`, "guest" as const])
      ),
    });
    usePipStore.setState({
      currentStream: null,
      isPipActive: false,
      isOnStreamPage: false,
    });

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
    queryClient.setQueryData(
      CHANNEL_KEYS.followed("twitch"),
      followedChannels.filter((channel) => channel.platform === "twitch")
    );
    queryClient.setQueryData(
      CHANNEL_KEYS.followed("kick"),
      followedChannels.filter((channel) => channel.platform === "kick")
    );
    queryClient.setQueryData(
      STREAM_KEYS.followed("twitch"),
      liveStreams.filter((stream) => stream.platform === "twitch")
    );
    queryClient.setQueryData(
      STREAM_KEYS.followed("kick"),
      liveStreams.filter((stream) => stream.platform === "kick")
    );

    const baseBridge = window.electronAPI;
    const platformHealth = {
      get: async () => ({
        kick: "healthy" as const,
        twitch: "healthy" as const,
        details: {},
      }),
      onChange: () => () => undefined,
    };
    const streamRecording = {
      getState: async () => ({ active: null, notice: null }),
      onStateChanged: () => () => undefined,
    };
    const storyBridge = new Proxy(baseBridge, {
      get(target, property, receiver) {
        if (property === "platformHealth") return platformHealth;
        if (property === "streamRecording") return streamRecording;
        return Reflect.get(target, property, receiver);
      },
    });
    Reflect.defineProperty(window, "electronAPI", {
      configurable: true,
      value: storyBridge,
    });

    return (
      <QueryClientProvider client={queryClient}>
        <Story />
      </QueryClientProvider>
    );
  };
}

function ShellContent() {
  return (
    <div className="min-h-full bg-[var(--color-background)] p-8">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-foreground-muted)]">
          Storybook canvas
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">Home content area</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-foreground-secondary)]">
          This neutral surface makes the complete desktop chrome, navigation hierarchy, and content
          boundary visible without coupling the shell story to a route-level page.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {["Continue watching", "Live now", "Recently followed"].map((label) => (
            <div
              key={label}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-5"
            >
              <div className="aspect-video rounded-lg bg-[var(--color-background-tertiary)]" />
              <p className="mt-3 text-sm font-bold text-white">{label}</p>
              <p className="mt-1 text-xs text-[var(--color-foreground-muted)]">
                Example content module
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Components/Layout/AppLayout",
  component: AppLayout,
  parameters: {
    layout: "fullscreen",
    docs: {
      story: { inline: false },
      description: {
        component:
          "The complete desktop shell: frameless title bar, top navigation, service banners, collapsible navigation, followed channels, and main content boundary.",
      },
    },
  },
  decorators: [withAppRouter, withShellState()],
  args: {
    children: <ShellContent />,
  },
} satisfies Meta<typeof AppLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {};

export const CollapsedSidebar: Story = {
  decorators: [withShellState({ collapsed: true })],
};

export const TheaterMode: Story = {
  decorators: [withShellState({ collapsed: true, theater: true })],
};
