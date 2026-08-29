import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ChatComposerReplyPreview, ChatMessageReplyPreview } from "./ChatReply";
import { REPLY_FIXTURE } from "./chat-story-fixtures";

const meta = {
  title: "Components/Chat/MessageParts/ChatReply",
  component: ChatMessageReplyPreview,
  decorators: [
    (Story) => (
      <div className="w-[380px] rounded-md bg-[#18181b] p-3 text-white">
        <Story />
      </div>
    ),
  ],
  args: { reply: REPLY_FIXTURE },
} satisfies Meta<typeof ChatMessageReplyPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MessagePreview: Story = {};
export const LongParentMessage: Story = {
  args: {
    reply: {
      ...REPLY_FIXTURE,
      parentMessageBody:
        "That clutch was unreal, and the entire room went quiet just before the final shot landed.",
    },
  },
};
export const ComposerPreview: Story = {
  render: () => (
    <ChatComposerReplyPreview
      displayName="MiraMakes"
      content="That clutch was unreal. One more round?"
      onCancel={fn()}
    />
  ),
};
