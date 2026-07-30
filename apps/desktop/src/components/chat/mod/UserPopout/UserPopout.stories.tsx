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
const storyBadgeUrls = [
  "https://static-cdn.jtvnw.net/badges/v1/743a0f3b-84b3-450b-96a0-503d7f4a9764/1",
  "https://static-cdn.jtvnw.net/badges/v1/743a0f3b-84b3-450b-96a0-503d7f4a9764/2",
  "https://static-cdn.jtvnw.net/badges/v1/743a0f3b-84b3-450b-96a0-503d7f4a9764/3",
  "https://static-cdn.jtvnw.net/badges/v1/eb4a8a4c-eacd-4f5e-b9f2-394348310442/1",
  "https://static-cdn.jtvnw.net/badges/v1/eb4a8a4c-eacd-4f5e-b9f2-394348310442/2",
  "https://static-cdn.jtvnw.net/badges/v1/b817aba4-fad8-49e2-b88a-7cc744dfa6ec/1",
];
const openingStoryMessage = makeChatMessage(22, {
  id: "message-mira-latest",
  platform: "twitch",
  channel: TWITCH_CHANNEL,
  userId: "user-mira",
  username: "miramakes",
  displayName: "MiraMakes",
  badges: Array.from({ length: 6 }, (_, index) => ({
    setId: `story-badge-${index}`,
    version: "1",
    imageUrl: storyBadgeUrls[index],
    title: `Story badge ${index + 1}`,
  })),
  rawContent: "That clutch was unreal. One more round?",
  content: [
    { type: "text", content: "That clutch was unreal — " },
    { type: "link", url: "https://twitch.tv", text: "watch it again" },
  ],
});
useChatStore.setState((state) => ({
  messagesByChannel: {
    ...state.messagesByChannel,
    [TWITCH_CHANNEL_KEY]: [
      ...(state.messagesByChannel[TWITCH_CHANNEL_KEY] ?? []),
      makeChatMessage(20, {
        id: "message-mira-deleted",
        platform: "twitch",
        channel: TWITCH_CHANNEL,
        userId: "user-mira",
        username: "miramakes",
        displayName: "MiraMakes",
        rawContent: "The retained deleted row still follows your chat preference.",
        content: [
          {
            type: "text",
            content: "The retained deleted row still follows your chat preference.",
          },
        ],
        isDeleted: true,
      }),
      makeChatMessage(21, {
        id: "message-reply-to-mira",
        platform: "twitch",
        channel: TWITCH_CHANNEL,
        userId: "user-jules",
        username: "jules",
        displayName: "Jules",
        rawContent: "Absolutely — queue it up.",
        content: [{ type: "text", content: "Absolutely — queue it up." }],
        replyTo: {
          parentMessageId: "message-mira-deleted",
          parentUserId: "user-mira",
          parentUsername: "miramakes",
          parentDisplayName: "MiraMakes",
          parentMessageBody: "One more round?",
        },
      }),
      openingStoryMessage,
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
    openingMessage: openingStoryMessage,
    badgeCatalog: {
      state: "ready",
      sourceLabel: "Twitch · Live chat",
      retry: fn(),
    },
    publicActions: {
      replyEligibility: { state: "eligible" },
      onReply: fn(),
      onViewChannel: fn(),
    },
    open: true,
    onOpenChange: fn(),
  },
} satisfies Meta<typeof UserPopout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchUser: Story = {};

export const GuestActions: Story = {
  args: {
    publicActions: {
      replyEligibility: null,
      onReply: fn(),
      onViewChannel: fn(),
    },
  },
};

export const IneligibleReply: Story = {
  args: {
    publicActions: {
      replyEligibility: {
        state: "ineligible",
        reason: "Followers-only chat is enabled",
      },
      onReply: fn(),
      onViewChannel: fn(),
    },
  },
};
