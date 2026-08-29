import type { Meta, StoryObj } from "@storybook/react-vite";

import { FirstTimeChatHighlight } from "./FirstTimeChatHighlight";

const meta = {
  title: "Components/Chat/Highlights/FirstTimeChat",
  component: FirstTimeChatHighlight,
  args: {
    children: (
      <div className="px-1 py-1 text-sm">
        <strong className="text-[#38bdf8]">NewHere:</strong> First stream, this setup is amazing!
      </div>
    ),
  },
} satisfies Meta<typeof FirstTimeChatHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
