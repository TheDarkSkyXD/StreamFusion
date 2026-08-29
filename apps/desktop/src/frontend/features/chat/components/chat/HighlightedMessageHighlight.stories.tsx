import type { Meta, StoryObj } from "@storybook/react-vite";

import { HighlightedMessageHighlight } from "./HighlightedMessageHighlight";

const meta = {
  title: "Components/Chat/Highlights/HighlightedMessage",
  component: HighlightedMessageHighlight,
  args: {
    platform: "twitch",
    children: (
      <span>
        <strong>NovaFriend:</strong> This deserves the spotlight!
      </span>
    ),
  },
} satisfies Meta<typeof HighlightedMessageHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Twitch: Story = {};
export const Kick: Story = { args: { platform: "kick" } };
