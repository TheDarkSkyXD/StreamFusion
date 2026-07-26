import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ChatReplyButton } from "./ChatReplyButton";

const meta = {
  title: "Components/Chat/Actions/ChatReplyButton",
  component: ChatReplyButton,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="rounded-md bg-[#2d2d2d] p-2 text-white">
        <Story />
      </div>
    ),
  ],
  args: { onClick: fn() },
} satisfies Meta<typeof ChatReplyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
