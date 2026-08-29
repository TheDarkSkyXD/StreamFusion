import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";

import { seedChatSubsystemStoryStores } from "../chat-subsystem-story-fixtures";
import { RaidTargetPicker } from "./RaidTargetPicker";

const meta = {
  title: "Components/Chat/Moderation/Raid Target Picker",
  component: RaidTargetPicker,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => {
      seedChatSubsystemStoryStores();
      return (
        <div className="w-[360px] rounded-lg border border-[#333] bg-[#0f0f12] p-4">
          <Story />
        </div>
      );
    },
  ],
  args: {
    selfBroadcasterId: "storybook-channel",
    disabled: false,
    onChange: fn(),
  },
} satisfies Meta<typeof RaidTargetPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FollowedChannels: Story = {};

export const Filtered: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.type(
      within(canvasElement).getByRole("textbox", { name: "Raid target search" }),
      "cozy"
    );
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};
