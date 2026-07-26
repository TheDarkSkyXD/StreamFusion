import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { useChatStore } from "@/store/chat-store";
import { ChatMessageList } from "./ChatMessageList";
import { KICK_MESSAGE, seedChatStoryStores } from "./chat-story-fixtures";

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
    onReply: fn(),
    onPin: fn(),
    onTimeout: fn(),
    onBan: fn(),
    onDelete: fn(),
    selfUserId: "viewer-twitch",
  },
} satisfies Meta<typeof ChatMessageList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchConversation: Story = {};
export const KickConversation: Story = {
  loaders: [
    () => {
      useChatStore.setState({ messages: [KICK_MESSAGE] });
      return {};
    },
  ],
  args: {
    onPin: undefined,
  },
};
export const EmptyChannel: Story = {
  loaders: [
    () => {
      useChatStore.setState({ messages: [] });
      return {};
    },
  ],
  args: { onPin: undefined },
};
