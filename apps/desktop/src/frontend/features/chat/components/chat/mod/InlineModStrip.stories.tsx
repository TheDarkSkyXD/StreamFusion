import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { InlineModStrip } from "./InlineModStrip";

const meta = {
  title: "Components/Chat/Moderation/Inline Mod Strip",
  component: InlineModStrip,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-[420px] overflow-hidden rounded-lg border border-[#333] bg-[#1a1a1a]">
        <Story />
      </div>
    ),
  ],
  args: {
    platform: "twitch",
    isBroadcaster: true,
    channelId: "storybook-channel",
    channelSlug: "novaarcade",
    onActionClick: fn(),
    roomState: {
      slowMode: 30,
      followersOnly: 10,
      subscribersOnly: true,
      emoteOnly: false,
      uniqueChat: true,
      shieldMode: false,
    },
  },
} satisfies Meta<typeof InlineModStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchBroadcaster: Story = {};

export const TwitchModerator: Story = {
  args: { isBroadcaster: false },
};

export const KickModerator: Story = {
  args: {
    platform: "kick",
    isBroadcaster: false,
    channelSlug: "pixelnomad",
    roomState: {
      slowMode: null,
      followersOnly: null,
      subscribersOnly: false,
      emoteOnly: true,
      uniqueChat: false,
      shieldMode: false,
    },
  },
};
