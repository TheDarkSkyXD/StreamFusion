import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";

import { seedChatSubsystemStoryStores } from "../../chat-subsystem-story-fixtures";
import { UserPopoutFooter } from "./UserPopoutFooter";

const meta = {
  title: "Components/Chat/Moderation/User Popout/Footer",
  component: UserPopoutFooter,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => {
      seedChatSubsystemStoryStores();
      return (
        <div className="w-[440px] rounded-lg bg-[#0f0f12] p-5">
          <Story />
        </div>
      );
    },
  ],
  args: {
    userId: "user-mira",
    username: "miramakes",
    platform: "twitch",
    channelId: "storybook-channel",
    channelSlug: "novaarcade",
    isBroadcaster: true,
    latestMessageId: "message-mira-latest",
    onActionSuccess: fn(),
  },
} satisfies Meta<typeof UserPopoutFooter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchBroadcaster: Story = {};

export const TimeoutDialog: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Timeout user" }));
  },
};

export const KickModerator: Story = {
  args: {
    platform: "kick",
    channelSlug: "pixelnomad",
    isBroadcaster: false,
    kickChatroomId: 9182,
  },
};

export const WithoutRecentMessage: Story = {
  args: { latestMessageId: null },
};
