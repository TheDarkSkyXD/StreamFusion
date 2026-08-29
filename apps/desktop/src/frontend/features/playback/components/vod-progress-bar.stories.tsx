import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { usePlaybackPositionStore } from "@/store/playback-position-store";

import { VodProgressBar } from "./vod-progress-bar";

const STORY_VIDEO_ID = "vod-progress-story";

function installPlaybackPosition(position: number | null): () => void {
  const previousState = usePlaybackPositionStore.getState();

  usePlaybackPositionStore.setState({
    positions:
      position === null
        ? {}
        : {
            [`twitch-${STORY_VIDEO_ID}`]: {
              videoId: STORY_VIDEO_ID,
              platform: "twitch",
              position,
              duration: 3_600,
              lastUpdated: 0,
              title: "Storybook VOD",
            },
          },
  });

  return () => {
    usePlaybackPositionStore.setState(previousState, true);
  };
}

const meta = {
  title: "Components/Stream/VodProgressBar",
  component: VodProgressBar,
  decorators: [
    (Story) => (
      <div className="relative h-48 w-[640px] overflow-hidden rounded-lg bg-[#252525]">
        <div className="p-5 text-sm text-white/60">VOD thumbnail</div>
        <Story />
      </div>
    ),
  ],
  args: {
    platform: "twitch",
    videoId: STORY_VIDEO_ID,
  },
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A saved playback indicator. The stories seed the local position store directly, with no persistence or playback request involved.",
      },
    },
  },
} satisfies Meta<typeof VodProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Partial: Story = {
  beforeEach: () => installPlaybackPosition(1_440),
  play: async ({ canvasElement }) => {
    const progress = within(canvasElement).getByRole("progressbar", { name: "Watch progress" });
    await expect(progress).toHaveAttribute("aria-valuenow", "40");
  },
};

export const Completed: Story = {
  beforeEach: () => installPlaybackPosition(3_420),
  play: async ({ canvasElement }) => {
    const progress = within(canvasElement).getByRole("progressbar", { name: "Watch progress" });
    await expect(progress).toHaveAttribute("aria-valuenow", "100");
  },
};

export const Absent: Story = {
  beforeEach: () => installPlaybackPosition(null),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("progressbar")).not.toBeInTheDocument();
  },
};
