import type { Meta, StoryObj } from "@storybook/react-vite";

import { DeletedMessageHighlightCozy } from "./DeletedMessageHighlightCozy";

const meta = {
  title: "Components/Chat/Moderation/DeletedMessageHighlightCozy",
  component: DeletedMessageHighlightCozy,
  args: {
    content: <span>spoiler text removed by a moderator</span>,
    deletedTime: "3:42 PM",
    mode: "compact",
    moderator: <strong className="text-[#38bdf8]">ChannelMod</strong>,
    sender: <strong className="text-[#f472b6]">MiraMakes:</strong>,
  },
} satisfies Meta<typeof DeletedMessageHighlightCozy>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Compact: Story = {};
export const Audit: Story = {
  args: { mode: "audit", auditDetail: <> · Twitch · id message-1842</> },
};
export const MessageOnly: Story = { args: { mode: "message" } };
