import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { makePrediction, seedChatStoryStores } from "./chat-story-fixtures";
import { PredictionBanner } from "./PredictionBanner";

seedChatStoryStores();

const meta = {
  title: "Components/Chat/Banners/PredictionBanner",
  component: PredictionBanner,
  decorators: [
    (Story) => (
      <div className="w-[420px] overflow-hidden rounded-md bg-[#18181b] text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    prediction: makePrediction("twitch"),
    onDismiss: fn(),
    onAutoDismiss: fn(),
  },
} satisfies Meta<typeof PredictionBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchActive: Story = {};
export const KickActive: Story = {
  args: { prediction: makePrediction("kick") },
};
export const Locked: Story = {
  args: {
    prediction: makePrediction("twitch", { status: "LOCKED" }),
  },
};
export const Resolved: Story = {
  args: {
    prediction: makePrediction("twitch", {
      id: "prediction-resolved",
      status: "RESOLVED",
      winningOutcomeId: "yes",
      endedAt: new Date().toISOString(),
    }),
  },
};
export const UnifiedStyle: Story = {
  decorators: [
    (Story) => {
      seedChatStoryStores({ predictionStyle: "unified" });
      return <Story />;
    },
  ],
};
