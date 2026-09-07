import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { useAuthStore } from "../../../../auth/components/state/auth-store";
import { MergedChatFeed } from "../../../components/chat/MergedChatFeed";
import { createMultiChatChannel } from "../../../components/state/multi-chat-feed";
import { useChatStore } from "../../../components/state/chat-store";
import { useEmoteStore } from "../../../components/state/emote-store";
import { useRoomStateStore } from "../../../components/state/room-state-store";
import {
  KICK_CHANNEL,
  KICK_CHANNEL_KEY,
  TWITCH_CHANNEL,
  TWITCH_CHANNEL_KEY,
  makeChatMessage,
  seedChatStoryStores,
} from "./chat-story-fixtures";

const mixedChannels = [
  createMultiChatChannel("twitch", TWITCH_CHANNEL, "NovaArcade"),
  createMultiChatChannel("kick", KICK_CHANNEL, "PixelNomad"),
];
const longNameChannels = [
  createMultiChatChannel(
    "twitch",
    "a-very-long-twitch-channel-name-that-must-truncate",
    "A very long Twitch channel name that must truncate"
  ),
  createMultiChatChannel(
    "kick",
    "another-very-long-kick-channel-name-that-must-truncate",
    "Another very long Kick channel name that must truncate"
  ),
];
const mixedTwitchMessages = [
  makeChatMessage(2, { platform: "twitch", channel: TWITCH_CHANNEL }),
  makeChatMessage(4, { platform: "twitch", channel: TWITCH_CHANNEL }),
  makeChatMessage(6, { platform: "twitch", channel: TWITCH_CHANNEL }),
];

function installMessages(
  messagesByChannel: Record<string, ReturnType<typeof makeChatMessage>[]>
): () => void {
  const previousAuthState = useAuthStore.getState();
  const previousChatState = useChatStore.getState();
  const previousEmoteState = useEmoteStore.getState();
  const previousRoomState = useRoomStateStore.getState();
  seedChatStoryStores();
  useChatStore.setState({ messagesByChannel });

  return () => {
    useRoomStateStore.setState(previousRoomState, true);
    useEmoteStore.setState(previousEmoteState, true);
    useChatStore.setState(previousChatState, true);
    useAuthStore.setState(previousAuthState, true);
  };
}

const meta = {
  title: "Components/Chat/Messages/MergedChatFeed",
  component: MergedChatFeed,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-[680px] w-[380px] bg-[var(--color-background-secondary)] text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    channels: mixedChannels,
    onSelectChannel: fn(),
  },
} satisfies Meta<typeof MergedChatFeed>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MixedChannels: Story = {
  beforeEach: () =>
    installMessages({
      [TWITCH_CHANNEL_KEY]: mixedTwitchMessages,
      [KICK_CHANNEL_KEY]: [
        makeChatMessage(7, { platform: "kick", channel: KICK_CHANNEL }),
        makeChatMessage(9, { platform: "kick", channel: KICK_CHANNEL }),
      ],
    }),
};

export const LongSourceNames: Story = {
  args: { channels: longNameChannels },
  decorators: [
    (Story) => (
      <div className="h-[680px] w-[280px]">
        <Story />
      </div>
    ),
  ],
  beforeEach: () =>
    installMessages({
      [longNameChannels[0].key]: [
        makeChatMessage(12, {
          platform: "twitch",
          channel: longNameChannels[0].channel,
          timestamp: new Date(Date.UTC(2026, 6, 26, 20, 12, 0)),
        }),
      ],
      [longNameChannels[1].key]: [
        makeChatMessage(13, {
          platform: "kick",
          channel: longNameChannels[1].channel,
          timestamp: new Date(Date.UTC(2026, 6, 26, 20, 13, 0)),
        }),
      ],
    }),
};

export const Empty: Story = {
  args: { channels: [] },
  beforeEach: () => installMessages({}),
};
