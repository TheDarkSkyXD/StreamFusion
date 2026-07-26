import type { Meta, StoryObj } from "@storybook/react-vite";
import type Hls from "hls.js";
import { fn } from "storybook/test";

import { VideoStatsOverlay } from "./video-stats-overlay";

const buffered: TimeRanges = {
  length: 1,
  start: () => 110,
  end: () => 138.42,
};

const hlsFixture = {
  currentLevel: 0,
  levels: [
    {
      width: 1920,
      height: 1080,
      bitrate: 7_500_000,
      frameRate: 60,
      videoCodec: "avc1.64002a",
      audioCodec: "mp4a.40.2",
    },
  ],
  bandwidthEstimate: 11_800_000,
  latency: 2.41,
  config: { lowLatencyMode: true },
} as unknown as Hls;

const videoFixture = {
  videoWidth: 1920,
  videoHeight: 1080,
  clientWidth: 1280,
  clientHeight: 720,
  currentTime: 121.2,
  buffered,
  playbackRate: 1,
  getVideoPlaybackQuality: () => ({
    creationTime: 0,
    totalVideoFrames: 18_240,
    droppedVideoFrames: 3,
    corruptedVideoFrames: 0,
  }),
} as unknown as HTMLVideoElement;

const meta = {
  title: "Components/Player/Twitch/VideoStatsOverlay",
  component: VideoStatsOverlay,
  decorators: [
    (Story) => (
      <div className="relative aspect-video w-[960px] overflow-hidden rounded-xl bg-black">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "centered" },
  args: {
    hls: hlsFixture,
    video: videoFixture,
    onClose: fn(),
  },
} satisfies Meta<typeof VideoStatsOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LowLatency1080p60: Story = {};
export const StandardLatency: Story = {
  args: {
    hls: {
      ...hlsFixture,
      latency: null,
      config: { ...hlsFixture.config, lowLatencyMode: false },
    } as unknown as Hls,
  },
};
export const AwaitingPlayer: Story = {
  args: { hls: null, video: null },
  parameters: {
    docs: {
      description: {
        story:
          "The overlay intentionally renders nothing until both HLS and video telemetry exist.",
      },
    },
  },
};
