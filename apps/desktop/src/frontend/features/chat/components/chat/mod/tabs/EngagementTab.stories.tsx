import type { Meta, StoryObj } from "@storybook/react-vite";

import { seedChatSubsystemStoryStores } from "../../chat-subsystem-story-fixtures";
import { EngagementTab } from "./EngagementTab";

const meta = {
  title: "Components/Chat/Moderation/Engagement/Tab",
  component: EngagementTab,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => {
      seedChatSubsystemStoryStores();
      return (
        <div className="h-[640px] w-[440px] overflow-hidden rounded-lg bg-[#0f0f0f]">
          <Story />
        </div>
      );
    },
  ],
  args: { channelId: "storybook-channel" },
} satisfies Meta<typeof EngagementTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CreateControls: Story = {};
