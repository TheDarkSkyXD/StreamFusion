import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { userEvent, within } from "storybook/test";
import { createChatReplayPlaybackStore } from "@/features/chat/data/chat-replay-playback-store";
import { clearChatReplayWindowCache } from "@/features/chat/data/use-chat-replay";
import type { ChatReplayWindowResult } from "@shared/chat-replay-types";

import { ChatReplaySession } from "./chat-replay-session";
import { emptyChatReplay, supportedChatReplay } from "./chat-replay-story-fixtures";

const defaultPlaybackStore = createChatReplayPlaybackStore();

function SessionFixture({
  result,
  width,
  pending = false,
}: {
  result: ChatReplayWindowResult;
  width: number;
  pending?: boolean;
}) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width, writable: true });
  clearChatReplayWindowCache();
  window.electronAPI.videos.getChatReplayWindow = pending
    ? () => new Promise(() => undefined)
    : async () => ({ success: true, data: result });
  window.electronAPI.videos.cancelChatReplayWindow = async () => ({ cancelled: true });

  const [playbackStore] = useState(() => {
    const store = createChatReplayPlaybackStore();
    store.publish({ currentTime: 3_625, isPlaying: true, playbackRate: 1 });
    return store;
  });

  return (
    <div className="flex h-[42rem] w-[min(72rem,95vw)] justify-end overflow-hidden rounded-lg border border-[#333333] bg-black">
      <ChatReplaySession platform="twitch" videoId="vod-story-123" playbackStore={playbackStore} />
    </div>
  );
}

const meta = {
  title: "Components/Chat Replay/Session",
  component: ChatReplaySession,
  parameters: { layout: "centered" },
  args: {
    platform: "twitch",
    videoId: "vod-story-123",
    playbackStore: defaultPlaybackStore,
  },
} satisfies Meta<typeof ChatReplaySession>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DesktopReady: Story = {
  render: () => <SessionFixture result={supportedChatReplay} width={1280} />,
};

export const DesktopLoading: Story = {
  render: () => <SessionFixture result={supportedChatReplay} width={1280} pending />,
};

export const DesktopError: Story = {
  render: () => (
    <SessionFixture
      width={1280}
      result={{
        capability: "transient-failure",
        platform: "twitch",
        videoId: "vod-story-123",
        reason: "The archive service timed out.",
      }}
    />
  ),
};

export const DesktopEmpty: Story = {
  render: () => <SessionFixture result={emptyChatReplay} width={1280} />,
};

export const CompactDrawer: Story = {
  render: () => <SessionFixture result={supportedChatReplay} width={768} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: "Open Chat Replay" })
    );
  },
};
