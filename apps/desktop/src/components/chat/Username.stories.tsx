import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { seedChatStoryStores } from "./chat-story-fixtures";
import { Username } from "./Username";

seedChatStoryStores();

const meta = {
  title: "Components/Chat/MessageParts/Username",
  component: Username,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="rounded-md bg-[#18181b] p-4 text-sm text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    userId: "user-mira",
    username: "miramakes",
    displayName: "MiraMakes",
    color: "#f472b6",
    platform: "twitch",
    onClick: fn(),
  },
} satisfies Meta<typeof Username>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Twitch: Story = {};
export const KickUncolored: Story = {
  args: {
    username: "kickviewer",
    displayName: "KickViewer",
    platform: "kick",
    color: undefined,
  },
};
export const AttachedSuffix: Story = {
  args: {
    suffix: <span className="text-white">:</span>,
    keepSuffixAttached: true,
  },
};
