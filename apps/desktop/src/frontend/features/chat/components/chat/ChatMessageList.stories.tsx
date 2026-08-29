import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ChatMessageList } from "./ChatMessageList";
import { KICK_CHANNEL_KEY, seedChatStoryStores, TWITCH_CHANNEL_KEY } from "./chat-story-fixtures";

seedChatStoryStores();

const meta = {
  title: "Components/Chat/Messages/ChatMessageList",
  component: ChatMessageList,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-[560px] w-[420px] bg-[#18181b] text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    channelKey: TWITCH_CHANNEL_KEY,
    onReply: fn(),
    onPin: fn(),
    onTimeout: fn(),
    onWarn: fn(),
    onBan: fn(),
    onDelete: fn(),
    selfUserId: "viewer-twitch",
  },
} satisfies Meta<typeof ChatMessageList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchConversation: Story = {};
export const KickConversation: Story = {
  args: {
    channelKey: KICK_CHANNEL_KEY,
    onPin: undefined,
  },
};
export const EmptyChannel: Story = {
  args: {
    channelKey: "twitch:empty-story-channel",
    onPin: undefined,
  },
};
