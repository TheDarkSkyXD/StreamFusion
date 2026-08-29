import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ContextualEmoteRow } from "./ContextualEmoteRow";
import { STORY_CHANNEL_ID, seedChatStoryStores } from "./chat-story-fixtures";

seedChatStoryStores();

const meta = {
  title: "Components/Chat/Autocomplete/ContextualEmoteRow",
  component: ContextualEmoteRow,
  decorators: [
    (Story) => (
      <div className="w-[420px] rounded-md bg-[#18181b] p-2 text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    inputValue: ":ka",
    cursorPosition: 3,
    platform: "twitch",
    channelId: STORY_CHANNEL_ID,
    keyboardActive: true,
    onSelect: fn(),
    onClose: fn(),
    onResultCountChange: fn(),
  },
} satisfies Meta<typeof ContextualEmoteRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchMatch: Story = {};
export const KickMatch: Story = {
  args: { inputValue: ":che", cursorPosition: 4, platform: "kick" },
};
export const NoMatch: Story = {
  args: { inputValue: ":zzz", cursorPosition: 4 },
};
export const InactiveToken: Story = {
  args: { inputValue: "hello ", cursorPosition: 6 },
};
