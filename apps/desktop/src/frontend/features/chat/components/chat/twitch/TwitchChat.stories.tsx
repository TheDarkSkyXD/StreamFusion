import type { Meta, StoryObj } from "@storybook/react-vite";
import { TWITCH_CHANNEL } from "../chat-story-fixtures";
import { installChatOrchestratorStoryMocks } from "../chat-subsystem-story-fixtures";
import { TwitchChat } from "./TwitchChat";

const meta = {
  title: "Components/Chat/Platform Shells/Twitch Chat",
  component: TwitchChat,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "The production Twitch chat shell with deterministic store state. Its IRC and emote-provider seams are replaced by local Storybook no-ops.",
      },
    },
  },
  args: {
    channel: TWITCH_CHANNEL,
  },
} satisfies Meta<typeof TwitchChat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AnonymousViewer: Story = {
  render: (args) => {
    installChatOrchestratorStoryMocks();
    return (
      <div className="h-[640px] w-[360px] overflow-hidden rounded-lg border border-[#333]">
        <TwitchChat {...args} />
      </div>
    );
  },
};
