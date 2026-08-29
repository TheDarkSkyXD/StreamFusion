import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { seedChatStoryStores } from "../chat-story-fixtures";
import { QuickEmoteActionBar } from "./QuickEmoteActionBar";

const meta = {
  title: "Components/Chat/Input/Quick Emote Action Bar",
  component: QuickEmoteActionBar,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => {
      seedChatStoryStores();
      return (
        <div className="w-[341px] rounded-md bg-[#191919] p-1">
          <Story />
        </div>
      );
    },
  ],
  args: {
    platform: "twitch",
    onSelect: fn(),
  },
} satisfies Meta<typeof QuickEmoteActionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchRecents: Story = {};

export const KickRecents: Story = {
  args: { platform: "kick" },
};

export const Disabled: Story = {
  args: { disabled: true },
};
