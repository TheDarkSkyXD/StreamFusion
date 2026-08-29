import type { Meta, StoryObj } from "@storybook/react-vite";

import { BitsHighlight } from "./BitsHighlight";

const meta = {
  title: "Components/Chat/Highlights/Bits",
  component: BitsHighlight,
  args: {
    platform: "twitch",
    children: (
      <span>
        <strong>NovaFriend</strong> cheered 1,000 bits: clutch timing!
      </span>
    ),
  },
} satisfies Meta<typeof BitsHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Twitch: Story = {};
export const KickContext: Story = { args: { platform: "kick" } };
