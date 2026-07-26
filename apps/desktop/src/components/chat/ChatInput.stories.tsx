import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ComponentProps, useEffect, useRef } from "react";
import { fn } from "storybook/test";

import { withAppRouter } from "../../../.storybook/story-router";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import {
  STORY_CHANNEL_ID,
  seedChatStoryStores,
  TWITCH_CHANNEL,
  TWITCH_MESSAGE,
} from "./chat-story-fixtures";

seedChatStoryStores();

function ReplyComposer(props: ComponentProps<typeof ChatInput>) {
  const inputRef = useRef<ChatInputHandle>(null);

  useEffect(() => {
    inputRef.current?.replyTo(TWITCH_MESSAGE);
  }, []);

  return <ChatInput ref={inputRef} {...props} />;
}

const meta = {
  title: "Components/Chat/Composer/ChatInput",
  component: ChatInput,
  decorators: [
    withAppRouter,
    (Story) => (
      <div className="w-[440px] rounded-lg bg-[#18181b] p-3 text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    channel: TWITCH_CHANNEL,
    platform: "twitch",
    channelId: STORY_CHANNEL_ID,
    canSend: true,
    isAuthenticated: true,
    onAuthRequired: fn(),
    onOpenChannelPage: fn(),
    checkSubscriberEligibility: async () => ({ status: "subscribed" }),
  },
} satisfies Meta<typeof ChatInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchAuthenticated: Story = {};
export const KickAuthenticated: Story = {
  args: {
    channel: "pixelnomad",
    platform: "kick",
    chatroomId: 1842,
    kickUserId: "7419",
  },
};
export const Guest: Story = {
  args: {
    canSend: false,
    isAuthenticated: false,
  },
};
export const Disabled: Story = {
  args: { disabled: true },
};
export const Replying: Story = {
  render: (args) => <ReplyComposer {...args} />,
};
export const RestrictedRoom: Story = {
  decorators: [
    (Story) => {
      seedChatStoryStores({ roomModes: true });
      return <Story />;
    },
  ],
};
