import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { withAppRouter } from "../../../.storybook/story-router";
import { ChatQuickSettingsPopover } from "./ChatQuickSettingsPopover";
import { seedChatStoryStores } from "./chat-story-fixtures";

seedChatStoryStores();

const meta = {
  title: "Components/Chat/Settings/ChatQuickSettingsPopover",
  component: ChatQuickSettingsPopover,
  decorators: [
    withAppRouter,
    (Story) => (
      <div className="relative h-[460px] w-[380px] rounded-lg bg-[#18181b] p-4 text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    onClose: fn(),
  },
} satisfies Meta<typeof ChatQuickSettingsPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const FooterPlacement: Story = {
  decorators: [
    (Story) => (
      <div className="absolute inset-x-4 bottom-4">
        <Story />
      </div>
    ),
  ],
};
