import type { Meta, StoryObj } from "@storybook/react-vite";

import { GiftedSubHighlight } from "./GiftedSubHighlight";

const meta = {
  title: "Components/Chat/Highlights/GiftedSub",
  component: GiftedSubHighlight,
  args: {
    platform: "twitch",
    children: (
      <span>
        <strong>PixelNomad</strong> gifted 5 subscriptions to the community!
      </span>
    ),
  },
} satisfies Meta<typeof GiftedSubHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Twitch: Story = {};
export const Kick: Story = { args: { platform: "kick" } };
