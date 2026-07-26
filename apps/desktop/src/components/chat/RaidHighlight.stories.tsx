import type { Meta, StoryObj } from "@storybook/react-vite";

import { RaidHighlight } from "./RaidHighlight";

const meta = {
  title: "Components/Chat/Highlights/Raid",
  component: RaidHighlight,
  args: {
    platform: "twitch",
    children: (
      <span>
        <strong>RiftRunner</strong> raided with 4,218 viewers. Welcome in!
      </span>
    ),
  },
} satisfies Meta<typeof RaidHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Twitch: Story = {};
export const Kick: Story = { args: { platform: "kick" } };
