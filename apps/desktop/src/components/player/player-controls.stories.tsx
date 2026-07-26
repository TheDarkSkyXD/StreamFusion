import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PlayerControls } from "./player-controls";
import {
  PLAYER_BUFFERED_RANGES,
  PLAYER_QUALITIES,
  SAFE_PLAYER_POSTER,
} from "./player-story-fixtures";

const meta = {
  title: "Components/Player/PlayerControls",
  component: PlayerControls,
  decorators: [
    (Story) => (
      <div
        className="relative aspect-video w-[960px] overflow-hidden rounded-xl bg-cover bg-center"
        style={{ backgroundImage: `url("${SAFE_PLAYER_POSTER}")` }}
      >
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "The shared playback control overlay for live and archived media, including quality, captions, volume, theater, PiP, and fullscreen commands.",
      },
    },
  },
  args: {
    isPlaying: false,
    isLoading: false,
    volume: 72,
    muted: false,
    qualities: PLAYER_QUALITIES,
    currentQualityId: "auto",
    isFullscreen: false,
    isTheater: false,
    currentTime: 742,
    duration: 1_800,
    buffered: PLAYER_BUFFERED_RANGES,
    previewImage: SAFE_PLAYER_POSTER,
    playbackRate: 1,
    onTogglePlay: fn(),
    onVolumeChange: fn(),
    onToggleMute: fn(),
    onQualityChange: fn(),
    onToggleFullscreen: fn(),
    onToggleTheater: fn(),
    onTogglePip: fn(),
    onSeek: fn(),
    onSeekHover: fn(),
    onPlaybackRateChange: fn(),
  },
} satisfies Meta<typeof PlayerControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PausedVod: Story = {};

export const PlayingVod: Story = {
  args: {
    isPlaying: true,
  },
};

export const LoadingVod: Story = {
  args: {
    isLoading: true,
  },
};

export const Live: Story = {
  args: {
    duration: 0,
    currentTime: 0,
    onSeek: undefined,
    onPlaybackRateChange: undefined,
  },
};

export const Fullscreen: Story = { args: { isFullscreen: true } };

export const Theater: Story = { args: { isTheater: true } };
