import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CHAT_STORY_MOD_LOG } from "../../chat-subsystem-story-fixtures";
import { UserModHistory } from "./UserModHistory";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
});
client.setQueryData(
  [
    "modLog",
    "twitch",
    "storybook-channel",
    "storybook-channel",
    "user-mira",
    undefined,
    undefined,
    50,
    0,
  ],
  { state: "ready", entries: CHAT_STORY_MOD_LOG, coverage: "complete" }
);

const meta = {
  title: "Components/Chat/Moderation/User Popout/Mod History",
  component: UserModHistory,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <div className="w-[420px] rounded-lg bg-[#0f0f12] p-4 text-white">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    platform: "twitch",
    channelId: "storybook-channel",
    channelSlug: "storybook-channel",
    targetUserId: "user-mira",
  },
} satisfies Meta<typeof UserModHistory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithActions: Story = {};

export const Empty: Story = {
  args: {
    targetUserId: "user-without-history",
  },
};
