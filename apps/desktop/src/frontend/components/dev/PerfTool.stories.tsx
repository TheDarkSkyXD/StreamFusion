import type { Meta, StoryObj } from "@storybook/react-vite";

import { seedChatSubsystemStoryStores } from "../../features/chat/components/chat/chat-subsystem-story-fixtures";
import { PerfTool } from "./PerfTool";

const meta = {
  title: "Components/Developer Tools/Performance",
  component: PerfTool,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => {
      seedChatSubsystemStoryStores();
      return (
        <div className="w-[390px] rounded-lg border border-[#333] bg-[#101114] p-4">
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta<typeof PerfTool>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Dashboard: Story = {};
