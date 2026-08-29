import type { Meta, StoryObj } from "@storybook/react-vite";

import { ModerationActionHighlightCozy } from "./ModerationActionHighlightCozy";

const deletedMessages = (
  <ul className="space-y-1 text-xs text-[#d3d3d9]">
    <li>“first retained message”</li>
    <li>“second retained message”</li>
  </ul>
);

const meta = {
  title: "Components/Chat/Moderation/ModerationActionHighlightCozy",
  component: ModerationActionHighlightCozy,
  args: {
    actionLabel: "Timeout",
    deletedMessageCount: 2,
    deletedMessages,
    summary: (
      <p className="text-sm">
        <strong className="text-[#f472b6]">MiraMakes</strong> was timed out for 10 minutes by{" "}
        <strong className="text-[#38bdf8]">ChannelMod</strong>.
      </p>
    ),
  },
} satisfies Meta<typeof ModerationActionHighlightCozy>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Timeout: Story = {};
export const Ban: Story = { args: { actionLabel: "Ban" } };
