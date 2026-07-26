import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { seedChatSubsystemStoryStores } from "../../chat-subsystem-story-fixtures";
import { EngagementPolls } from "./EngagementPolls";

const meta = {
  title: "Components/Chat/Moderation/Engagement/Polls",
  component: EngagementPolls,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => {
      seedChatSubsystemStoryStores();
      return (
        <div className="w-[420px] rounded-lg bg-[#0f0f0f] p-4">
          <Story />
        </div>
      );
    },
  ],
  args: { channelId: "storybook-channel" },
} satisfies Meta<typeof EngagementPolls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CreateForm: Story = {};

export const DraftPoll: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Poll title" }), "What next?");
    await userEvent.type(canvas.getByRole("textbox", { name: "Choice 1" }), "Community games");
    await userEvent.type(canvas.getByRole("textbox", { name: "Choice 2" }), "Ranked");
    await userEvent.click(canvas.getByRole("button", { name: "Add choice" }));
  },
};
