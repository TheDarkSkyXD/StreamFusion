import type { Meta, StoryObj } from "@storybook/react-vite";

import { SubscriptionHighlight } from "./SubscriptionHighlight";

const meta = {
  title: "Components/Chat/Highlights/Subscription",
  component: SubscriptionHighlight,
  args: {
    platform: "twitch",
    children: (
      <span>
        <strong>NovaFriend</strong> subscribed at Tier 1. Welcome to the community!
      </span>
    ),
  },
} satisfies Meta<typeof SubscriptionHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Twitch: Story = {};
export const Kick: Story = { args: { platform: "kick" } };
