import type { Meta, StoryObj } from "@storybook/react-vite";

import { ChatEmote } from "./ChatEmote";
import {
  KAPPA_EMOTE,
  SEVEN_TV_EMOTE,
  seedChatStoryStores,
  ZERO_WIDTH_EMOTE,
} from "./chat-story-fixtures";

seedChatStoryStores();

const meta = {
  title: "Components/Chat/MessageParts/ChatEmote",
  component: ChatEmote,
  parameters: { layout: "centered" },
  args: {
    id: KAPPA_EMOTE.id,
    name: KAPPA_EMOTE.name,
    url: KAPPA_EMOTE.urls.url2x,
    platform: "twitch",
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-16 items-center rounded-lg bg-[#1a1a1a] px-4 text-sm text-white">
        Inline message <Story /> emote
      </div>
    ),
  ],
} satisfies Meta<typeof ChatEmote>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NativeTwitch: Story = {};
export const AnimatedThirdParty: Story = {
  args: {
    id: SEVEN_TV_EMOTE.id,
    name: SEVEN_TV_EMOTE.name,
    url: SEVEN_TV_EMOTE.urls.url2x,
    isAnimated: true,
  },
};
export const ZeroWidthOverlay: Story = {
  args: {
    id: ZERO_WIDTH_EMOTE.id,
    name: ZERO_WIDTH_EMOTE.name,
    url: ZERO_WIDTH_EMOTE.urls.url2x,
    isZeroWidth: true,
  },
};
