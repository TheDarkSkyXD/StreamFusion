import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";

import { makeChannel, makeStream } from "../../../.storybook/catalog-fixtures";
import { withAppRouter } from "../../../.storybook/story-router";
import { useAuthStore } from "../../store/auth-store";
import { StreamInfo } from "./stream-info";

const twitchStream = makeStream(0, {
  platform: "twitch",
  isMature: true,
  tags: ["English", "Ranked", "Drops Enabled"],
});
const twitchChannel = makeChannel(0, {
  id: twitchStream.channelId,
  platform: "twitch",
  username: twitchStream.channelName,
  displayName: twitchStream.channelDisplayName,
  isVerified: true,
});

const meta = {
  title: "Components/Stream/StreamInfo",
  component: StreamInfo,
  decorators: [
    withAppRouter,
    (Story) => (
      <div className="min-w-[760px] rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-5">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Channel header with live/offline metadata, category navigation, follow action, platform verification, viewer count, and uptime.",
      },
    },
  },
  args: {
    channel: twitchChannel,
    stream: twitchStream,
    isLoading: false,
  },
} satisfies Meta<typeof StreamInfo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LiveTwitch: Story = {};

export const LiveKick: Story = {
  args: {
    channel: makeChannel(1, {
      platform: "kick",
      isVerified: true,
      isPartner: true,
    }),
    stream: makeStream(1, {
      platform: "kick",
      isMature: false,
    }),
  },
};

export const Offline: Story = {
  args: {
    channel: makeChannel(2, {
      isLive: false,
      lastStreamTitle: "Back tomorrow with a new city build",
    }),
    stream: null,
  },
};

export const Loading: Story = {
  args: {
    channel: null,
    stream: null,
    isLoading: true,
  },
};

function OwnerView() {
  useEffect(() => {
    const previousUser = useAuthStore.getState().twitchUser;
    useAuthStore.setState({
      twitchUser: {
        id: twitchChannel.id,
        login: twitchChannel.username,
        displayName: twitchChannel.displayName,
        profileImageUrl: twitchChannel.avatarUrl,
        createdAt: "2021-04-18T10:00:00.000Z",
        broadcasterType: "partner",
      },
    });

    return () => useAuthStore.setState({ twitchUser: previousUser });
  }, []);

  return <StreamInfo channel={twitchChannel} stream={twitchStream} isLoading={false} />;
}

export const ChannelOwner: Story = {
  render: () => <OwnerView />,
};
