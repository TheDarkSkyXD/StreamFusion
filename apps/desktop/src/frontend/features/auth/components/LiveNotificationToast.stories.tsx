import type { Meta, StoryObj } from "@storybook/react-vite";

import { LiveNotificationToast } from "./LiveNotificationToast";

const meta = {
  title: "Components/Notifications/LiveNotificationToast",
  component: LiveNotificationToast,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Compact content used inside the global toast surface when a followed channel goes live.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[360px] rounded-lg border border-[#333333] bg-[#1a1a1a] p-4 shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
        <Story />
      </div>
    ),
  ],
  args: {
    notification: {
      id: "live-twitch-nova",
      platform: "twitch",
      channelId: "1842",
      channelName: "novaarcade",
      channelDisplayName: "Nova Arcade",
      channelAvatar: "",
      title: "Road to radiant, calm comms and good decisions",
      createdAt: Date.now() - 30_000,
    },
  },
  argTypes: {
    notification: { control: false },
  },
} satisfies Meta<typeof LiveNotificationToast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Twitch: Story = {};

export const Kick: Story = {
  args: {
    notification: {
      id: "live-kick-pixel",
      platform: "kick",
      channelId: "7421",
      channelName: "pixelnomad",
      channelDisplayName: "Pixel Nomad",
      channelAvatar: "",
      title: "Late-night ranked with the community",
      createdAt: Date.now() - 120_000,
    },
  },
};

export const LongTitle: Story = {
  args: {
    notification: {
      id: "live-twitch-long",
      platform: "twitch",
      channelId: "2819",
      channelName: "miramakes",
      channelDisplayName: "Mira Makes",
      channelAvatar: "",
      title:
        "Building an entire fantasy city from scratch with community suggestions and no shortcuts",
      createdAt: Date.now(),
    },
  },
};
