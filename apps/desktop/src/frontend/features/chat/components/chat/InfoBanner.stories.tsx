import type { Meta, StoryObj } from "@storybook/react-vite";
import { STORY_CHANNEL_ID, seedChatStoryStores } from "./chat-story-fixtures";
import { InfoBanner } from "./InfoBanner";

seedChatStoryStores({ roomModes: true });

const meta = {
  title: "Components/Chat/Banners/InfoBanner",
  component: InfoBanner,
  decorators: [
    (Story) => (
      <div className="w-[420px] rounded-md bg-[#18181b] p-3 text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    platform: "twitch",
    channelId: STORY_CHANNEL_ID,
  },
} satisfies Meta<typeof InfoBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchMultipleModes: Story = {};
export const TwitchFollowerSatisfied: Story = {
  args: { viewerSatisfiesFollowerOnly: true },
};
export const KickAccountAge: Story = { args: { platform: "kick" } };
export const NoChannel: Story = {
  args: { channelId: null },
  parameters: {
    docs: { description: { story: "An unresolved channel has no room-mode banner." } },
  },
};
