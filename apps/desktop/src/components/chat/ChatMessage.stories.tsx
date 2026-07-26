import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ChatMessage } from "./ChatMessage";
import {
  DELETED_MESSAGE,
  HIGHLIGHTED_MESSAGE,
  KICK_MESSAGE,
  makeChatMessage,
  REPLY_MESSAGE,
  SYSTEM_MESSAGE,
  seedChatStoryStores,
  TWITCH_MESSAGE,
} from "./chat-story-fixtures";

seedChatStoryStores();

const meta = {
  title: "Components/Chat/Messages/ChatMessage",
  component: ChatMessage,
  decorators: [
    (Story) => (
      <div className="w-[420px] overflow-hidden rounded-md bg-[#18181b] py-2 text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    message: TWITCH_MESSAGE,
    onReply: fn(),
    onPin: fn(),
    onTimeout: fn(),
    onWarn: fn(),
    onBan: fn(),
    onDelete: fn(),
    selfUserId: "viewer-twitch",
  },
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Twitch: Story = {};
export const Kick: Story = {
  args: { message: KICK_MESSAGE, onPin: undefined },
};
export const Reply: Story = { args: { message: REPLY_MESSAGE } };
export const Highlighted: Story = { args: { message: HIGHLIGHTED_MESSAGE } };
export const Deleted: Story = { args: { message: DELETED_MESSAGE } };
export const Action: Story = {
  args: {
    message: makeChatMessage(12, {
      type: "action",
      isAction: true,
      content: [{ type: "text", content: "celebrates the flawless round" }],
    }),
  },
};
export const System: Story = {
  args: {
    message: SYSTEM_MESSAGE,
    onReply: undefined,
    onPin: undefined,
    onTimeout: undefined,
    onWarn: undefined,
    onBan: undefined,
    onDelete: undefined,
  },
};
