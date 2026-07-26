import type { Meta, StoryObj } from "@storybook/react-vite";
import { KICK_CHANNEL } from "../chat-story-fixtures";
import { installChatOrchestratorStoryMocks } from "../chat-subsystem-story-fixtures";
import { KickChat } from "./KickChat";

const meta = {
  title: "Components/Chat/Platform Shells/Kick Chat",
  component: KickChat,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "The production Kick chat shell with deterministic store state. Its Pusher and emote-provider seams are replaced by local Storybook no-ops.",
      },
    },
  },
  args: {
    channel: KICK_CHANNEL,
  },
} satisfies Meta<typeof KickChat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AnonymousViewer: Story = {
  render: (args) => {
    installChatOrchestratorStoryMocks();
    return (
      <div className="h-[640px] w-[360px] overflow-hidden rounded-lg border border-[#333]">
        <KickChat {...args} />
      </div>
    );
  },
};
