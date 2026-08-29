import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import {
  PLAYER_BUFFERED_RANGES,
  PLAYER_QUALITIES,
  SAFE_PLAYER_POSTER,
} from "../player-story-fixtures";
import { TwitchPlayerControls } from "./twitch-player-controls";

const meta = {
  title: "Components/Player/Twitch/TwitchPlayerControls",
  component: TwitchPlayerControls,
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
  parameters: { layout: "centered" },
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
    onToggleVideoStats: fn(),
  },
} satisfies Meta<typeof TwitchPlayerControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PausedVod: Story = {};
export const PlayingVod: Story = { args: { isPlaying: true } };
export const LoadingVod: Story = { args: { isLoading: true } };
export const MutedVod: Story = { args: { muted: true, volume: 0 } };
export const Live: Story = {
  args: {
    currentTime: 0,
    duration: 0,
    buffered: undefined,
    onSeek: undefined,
    onSeekHover: undefined,
    previewImage: undefined,
  },
};
export const TheaterWithStats: Story = {
  args: { isTheater: true, showVideoStats: true },
};
export const Fullscreen: Story = {
  args: { isFullscreen: true, onToggleTheater: undefined },
};
