import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { seedChatSubsystemStoryStores } from "../../features/chat/components/chat/chat-subsystem-story-fixtures";
import { ChatSimTool } from "./ChatSimTool";

const meta = {
  title: "Components/Developer Tools/Chat Simulator",
  component: ChatSimTool,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => {
      seedChatSubsystemStoryStores();
      return (
        <div className="max-h-[720px] w-[390px] overflow-y-auto rounded-lg border border-[#333] bg-[#101114] p-4">
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta<typeof ChatSimTool>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchControls: Story = {};

export const KickControls: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const kickControl = canvas.queryByRole("button", { name: /kick/i });
    if (kickControl) await userEvent.click(kickControl);
  },
};
