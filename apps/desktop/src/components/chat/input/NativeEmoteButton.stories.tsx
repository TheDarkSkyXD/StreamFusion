import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { STORY_CHANNEL_ID, seedChatStoryStores } from "../chat-story-fixtures";
import { NativeEmoteButton } from "./NativeEmoteButton";

seedChatStoryStores();

const meta = {
  title: "Components/Chat/Input/Native Emote Button",
  component: NativeEmoteButton,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex h-12 items-stretch overflow-hidden rounded-md bg-[#191919]">
        <Story />
      </div>
    ),
  ],
  args: {
    platform: "twitch",
    channelId: STORY_CHANNEL_ID,
    isOpen: false,
    onOpenRequest: fn(),
    onEmoteSelect: fn(),
  },
} satisfies Meta<typeof NativeEmoteButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Twitch: Story = {};

export const Kick: Story = {
  args: {
    platform: "kick",
  },
};

export const OpenKickPicker: Story = {
  args: {
    platform: "kick",
    isOpen: true,
    viewerIsSubscribed: false,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};
