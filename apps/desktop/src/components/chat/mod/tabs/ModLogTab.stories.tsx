import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  CHAT_STORY_MOD_LOG,
  seedChatSubsystemStoryStores,
} from "../../chat-subsystem-story-fixtures";
import { UserPopoutProvider } from "../UserPopout/UserPopoutProvider";
import { ModLogTab } from "./ModLogTab";

function ModLogStory() {
  seedChatSubsystemStoryStores();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(
    [
      "modLog",
      "twitch",
      "storybook-channel",
      "storybook-channel",
      undefined,
      undefined,
      undefined,
      50,
      0,
    ],
    { state: "ready", entries: CHAT_STORY_MOD_LOG, coverage: "complete" }
  );

  return (
    <QueryClientProvider client={client}>
      <UserPopoutProvider>
        <ModLogTab
          platform="twitch"
          channelId="storybook-channel"
          channelSlug="storybook-channel"
        />
      </UserPopoutProvider>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Components/Chat/Moderation/Mod Log Tab",
  component: ModLogTab,
  parameters: { layout: "centered" },
  args: {
    platform: "twitch",
    channelId: "storybook-channel",
    channelSlug: "storybook-channel",
  },
} satisfies Meta<typeof ModLogTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithEntries: Story = {
  render: () => (
    <div className="h-[420px] w-[520px] overflow-hidden rounded-lg bg-[#0f0f0f]">
      <ModLogStory />
    </div>
  ),
};
