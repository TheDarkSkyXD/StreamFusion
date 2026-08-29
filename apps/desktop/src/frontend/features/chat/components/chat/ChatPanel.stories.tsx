import type { Meta, StoryObj } from "@storybook/react-vite";

import { useAuthStore } from "../../../../store/auth-store";
import { ChatPanel } from "./ChatPanel";
import { seedChatStoryStores } from "./chat-story-fixtures";

seedChatStoryStores();
useAuthStore.setState({
  twitchConnected: false,
  twitchUser: null,
  kickConnected: false,
  kickUser: null,
  isGuest: true,
});

const meta = {
  title: "Components/Chat/ChatPanel",
  component: ChatPanel,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-[680px] w-[440px] bg-[#0f0f0f] text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    initialPlatform: "twitch",
    initialChannel: "",
  },
} satisfies Meta<typeof ChatPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyTwitchPanel: Story = {};
