import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fn } from "storybook/test";

import { useChatStore } from "@/store/chat-store";
import { makeChatMessage, TWITCH_CHANNEL, TWITCH_CHANNEL_KEY } from "../../chat-story-fixtures";
import {
  CHAT_STORY_PROFILE,
  seedChatSubsystemStoryStores,
} from "../../chat-subsystem-story-fixtures";
import { UserPopout } from "./UserPopout";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
});
client.setQueryData(["userProfile", "twitch", "identity", "user-mira", "miramakes"], {
  state: "known",
  source: "official",
  value: {
    userId: "user-mira",
    username: "miramakes",
    displayName: CHAT_STORY_PROFILE.displayName,
    avatarUrl: CHAT_STORY_PROFILE.avatarUrl,
  },
});
client.setQueryData(["userProfile", "twitch", "account-created", "user-mira", "miramakes"], {
  state: "known",
  source: "first-party-fallback",
  value: CHAT_STORY_PROFILE.createdAt,
});
client.setQueryData(["userProfile", "twitch", "follow", "storybook-channel", "user-mira"], {
  state: "known",
  source: "official",
  value: CHAT_STORY_PROFILE.followSince,
});
client.setQueryData(["userProfile", "twitch", "channel", "miramakes"], {
  state: "known",
  source: "official",
  value: { id: "storybook-channel", username: TWITCH_CHANNEL, displayName: "Story Channel" },
});

seedChatSubsystemStoryStores();
useChatStore.setState((state) => ({
  messagesByChannel: {
    ...state.messagesByChannel,
    [TWITCH_CHANNEL_KEY]: [
      ...(state.messagesByChannel[TWITCH_CHANNEL_KEY] ?? []),
      makeChatMessage(20, {
        id: "message-mira-latest",
        platform: "twitch",
        channel: TWITCH_CHANNEL,
        userId: "user-mira",
        username: "miramakes",
        displayName: "MiraMakes",
        rawContent: "That clutch was unreal. One more round?",
        content: [{ type: "text", content: "That clutch was unreal. One more round?" }],
      }),
    ],
  },
}));

const meta = {
  title: "Components/Chat/Moderation/User Popout/Complete",
  component: UserPopout,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    ),
  ],
  args: {
    userId: "user-mira",
    username: "miramakes",
    platform: "twitch",
    channelId: "storybook-channel",
    channelSlug: TWITCH_CHANNEL,
    open: true,
    onOpenChange: fn(),
  },
} satisfies Meta<typeof UserPopout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchUser: Story = {};
