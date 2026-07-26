import type { Meta, StoryObj } from "@storybook/react-vite";

import { DeletedMessageHighlightCompact } from "./DeletedMessageHighlightCompact";

const meta = {
  title: "Components/Chat/Moderation/DeletedMessageHighlightCompact",
  component: DeletedMessageHighlightCompact,
  args: {
    content: <span>spoiler text removed by a moderator</span>,
    deletedTime: "3:42 PM",
    mode: "compact",
    moderator: <strong className="text-[#38bdf8]">ChannelMod</strong>,
    platform: "twitch",
    sender: <strong className="text-[#f472b6]">MiraMakes:</strong>,
  },
} satisfies Meta<typeof DeletedMessageHighlightCompact>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Compact: Story = {};
export const Audit: Story = {
  args: { mode: "audit", auditDetail: <> · Twitch · id message-1842</> },
};
export const MessageOnly: Story = { args: { mode: "message" } };
