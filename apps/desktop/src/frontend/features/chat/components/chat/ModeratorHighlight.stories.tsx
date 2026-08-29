import type { Meta, StoryObj } from "@storybook/react-vite";

import { ModeratorHighlight } from "./ModeratorHighlight";

const meta = {
  title: "Components/Chat/Highlights/Moderator",
  component: ModeratorHighlight,
  args: {
    platform: "twitch",
    children: (
      <div className="px-1 py-1 text-sm">
        <strong className="text-[#00a865]">ChannelMod:</strong> Please keep chat spoiler-free.
      </div>
    ),
  },
} satisfies Meta<typeof ModeratorHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Twitch: Story = {};
export const Kick: Story = { args: { platform: "kick" } };
