import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";

import { ChatReplayRail } from "./chat-replay-rail";
import { emptyChatReplay, supportedChatReplay } from "./chat-replay-story-fixtures";

const meta = {
  title: "Components/Chat Replay/Rail",
  component: ChatReplayRail,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Time-synchronized historical chat rail for archived videos, with seek controls and a compact drawer presentation.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="h-[42rem] overflow-hidden rounded-lg border border-[#333333]">
        <Story />
      </div>
    ),
  ],
  args: {
    result: supportedChatReplay,
    playback: { currentTime: 3_625, isPlaying: true, playbackRate: 1 },
    onSeek: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof ChatReplayRail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};

export const NoMessagesAtThisMoment: Story = {
  args: {
    playback: { currentTime: 120, isPlaying: false, playbackRate: 1 },
  },
};

export const EmptyArchive: Story = {
  args: { result: emptyChatReplay },
};

export const Drawer: Story = {
  args: { presentation: "drawer" },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};

export const Collapsed: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Collapse Chat Replay" })
    );
  },
};
