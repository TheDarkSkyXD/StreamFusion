import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";

import type { UnifiedChannel } from "@/backend/api/unified/platform-types";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";

import { FollowButton } from "./follow-button";

const twitchChannel: UnifiedChannel = {
  id: "twitch-river-arcade",
  platform: "twitch",
  username: "riverarcade",
  displayName: "River Arcade",
  avatarUrl: "",
  bannerUrl: "",
  bio: "Retro runs and new releases.",
  isLive: true,
  isVerified: true,
  isPartner: true,
};

const kickChannel: UnifiedChannel = {
  ...twitchChannel,
  id: "kick-river-arcade",
  platform: "kick",
};

function seedFollowState({
  followedChannel,
  kickConnected = false,
  twitchConnected = false,
}: {
  followedChannel?: UnifiedChannel;
  kickConnected?: boolean;
  twitchConnected?: boolean;
}) {
  useFollowStore.setState({
    localFollows: followedChannel ? [followedChannel] : [],
    sourceByKey: new Map(),
  });
  useAuthStore.setState({ kickConnected, twitchConnected });
}

function withFollowState(state: Parameters<typeof seedFollowState>[0]): Decorator {
  return (Story) => {
    seedFollowState(state);
    return <Story />;
  };
}

const meta = {
  title: "Components/UI/FollowButton",
  component: FollowButton,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      story: { inline: false },
      description: {
        component:
          "The app-specific follow action. It combines platform identity with optimistic, pending, failed, and already-following states from the follow store.",
      },
    },
  },
  args: {
    channel: twitchChannel,
    size: "sm",
  },
  argTypes: {
    channel: { control: false },
    size: {
      control: "select",
      options: ["default", "sm", "lg", "icon"],
    },
  },
} satisfies Meta<typeof FollowButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Twitch: Story = {
  decorators: [withFollowState({ twitchConnected: true })],
};

export const Kick: Story = {
  args: {
    channel: kickChannel,
  },
  decorators: [withFollowState({ kickConnected: true })],
};

export const Following: Story = {
  decorators: [withFollowState({ followedChannel: twitchChannel, twitchConnected: true })],
  parameters: {
    docs: {
      description: {
        story: "Hover the heart to reveal the unfollow affordance.",
      },
    },
  },
};
