import type { Meta, StoryObj } from "@storybook/react-vite";

import { CHAT_STORY_PROFILE } from "../../chat-subsystem-story-fixtures";
import { UserProfileHeader } from "./UserProfileHeader";

const meta = {
  title: "Components/Chat/Moderation/User Popout/Profile Header",
  component: UserProfileHeader,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-[440px] rounded-lg bg-[#0f0f12] p-5 text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    profile: CHAT_STORY_PROFILE,
    platform: "twitch",
  },
} satisfies Meta<typeof UserProfileHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchModerator: Story = {};

export const KickViewer: Story = {
  args: {
    platform: "kick",
    profile: {
      ...CHAT_STORY_PROFILE,
      username: "pixelnomad",
      displayName: "PixelNomad",
      subscription: null,
      isFounder: false,
      isVip: false,
      isMod: false,
    },
  },
};
