import type { Meta, StoryObj } from "@storybook/react-vite";

import { ChatBadge } from "./ChatBadge";
import { KICK_BADGE, TWITCH_BADGE } from "./chat-story-fixtures";

const meta = {
  title: "Components/Chat/MessageParts/ChatBadge",
  component: ChatBadge,
  parameters: { layout: "centered" },
  args: {
    badge: TWITCH_BADGE,
    platform: "twitch",
  },
} satisfies Meta<typeof ChatBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchModerator: Story = {};
export const KickSubscriber: Story = {
  args: { badge: KICK_BADGE, platform: "kick" },
};
export const MissingImage: Story = {
  args: {
    badge: { setId: "subscriber", version: "1", title: "No image" },
  },
  parameters: {
    docs: { description: { story: "Badges without an image URL intentionally render nothing." } },
  },
};
