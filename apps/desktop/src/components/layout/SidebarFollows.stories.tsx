import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CHANNEL_KEYS } from "@/hooks/queries/useChannels";
import { STREAM_KEYS } from "@/hooks/queries/useStreams";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";
import { usePipStore } from "@/store/pip-store";

import { makeChannel, makeStream } from "../../../.storybook/catalog-fixtures";
import { withAppRouter } from "../../../.storybook/story-router";
import { SidebarFollows } from "./SidebarFollows";

const followedChannels = Array.from({ length: 12 }, (_, index) => {
  const platform = index % 3 === 1 ? "kick" : "twitch";
  return makeChannel(index, {
    id: `${platform}-channel-${index + 1}`,
    platform,
    username: `channel${index + 1}`,
    displayName: [
      "Nova Arcade",
      "Pixel Nomad",
      "Mira Makes",
      "Rift Runner",
      "Cozy Circuit",
      "Night Signal",
    ][index % 6],
    avatarUrl: "",
    isLive: index < 6,
    isVerified: index % 4 === 0,
    isPartner: index % 5 === 0,
  });
});

const liveStreams = followedChannels.slice(0, 6).map((channel, index) =>
  makeStream(index, {
    id: `${channel.platform}-stream-${index + 1}`,
    platform: channel.platform,
    channelId: channel.id,
    channelName: channel.username,
    channelDisplayName: channel.displayName,
    channelAvatar: "",
    thumbnailUrl: "",
    viewerCount: 42_300 - index * 6_140,
    categoryName: ["VALORANT", "Just Chatting", "Art", "Minecraft"][index % 4],
  })
);

function withSidebarData(channels = followedChannels, streams = liveStreams): Decorator {
  return (Story) => {
    useAuthStore.setState({
      twitchConnected: false,
      kickConnected: false,
      twitchUser: null,
      kickUser: null,
      isGuest: true,
      initialized: true,
    });
    useFollowStore.setState({
      localFollows: channels,
      sourceByKey: new Map(
        channels.map((channel) => [`${channel.platform}:${channel.id}`, "guest" as const])
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
    const twitchChannels = channels.filter((channel) => channel.platform === "twitch");
    const kickChannels = channels.filter((channel) => channel.platform === "kick");
    queryClient.setQueryData(CHANNEL_KEYS.followed("twitch"), twitchChannels);
    queryClient.setQueryData(CHANNEL_KEYS.followed("kick"), kickChannels);
    queryClient.setQueryData(
      STREAM_KEYS.followed("twitch"),
      streams.filter((stream) => stream.platform === "twitch")
    );
    queryClient.setQueryData(
      STREAM_KEYS.followed("kick"),
      streams.filter((stream) => stream.platform === "kick")
    );

    return (
      <QueryClientProvider client={queryClient}>
        <Story />
      </QueryClientProvider>
    );
  };
}

const meta = {
  title: "Components/Layout/SidebarFollows",
  component: SidebarFollows,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Followed channels ordered with live streams first, then offline channels, using an isolated Storybook query cache.",
      },
    },
  },
  decorators: [
    withAppRouter,
    withSidebarData(),
    (Story) => (
      <div className="h-[650px] overflow-hidden bg-[var(--color-background-secondary)]">
        <Story />
      </div>
    ),
  ],
  args: {
    collapsed: false,
  },
} satisfies Meta<typeof SidebarFollows>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {};

export const Collapsed: Story = {
  args: {
    collapsed: true,
  },
};

export const Empty: Story = {
  decorators: [withSidebarData([], [])],
};
