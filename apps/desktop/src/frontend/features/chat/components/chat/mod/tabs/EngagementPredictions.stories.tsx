import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { seedChatSubsystemStoryStores } from "../../chat-subsystem-story-fixtures";
import { EngagementPredictions } from "./EngagementPredictions";

const meta = {
  title: "Components/Chat/Moderation/Engagement/Predictions",
  component: EngagementPredictions,
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
} satisfies Meta<typeof EngagementPredictions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CreateForm: Story = {};

export const DraftWithThirdOutcome: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Prediction title" }), "Next run?");
    await userEvent.type(canvas.getByRole("textbox", { name: "Outcome 1" }), "Personal best");
    await userEvent.type(canvas.getByRole("textbox", { name: "Outcome 2" }), "Reset");
    await userEvent.click(canvas.getByRole("button", { name: "Add outcome" }));
  },
};
