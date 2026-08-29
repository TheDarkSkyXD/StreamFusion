import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import {
  PLAYER_BUFFERED_RANGES,
  PLAYER_QUALITIES,
  SAFE_PLAYER_POSTER,
} from "../player-story-fixtures";
import { TwitchVodPlayerControls } from "./twitch-vod-player-controls";

const meta = {
  title: "Components/Player/Twitch/TwitchVodPlayerControls",
  component: TwitchVodPlayerControls,
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
  },
} satisfies Meta<typeof TwitchVodPlayerControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Paused: Story = {};
export const Playing: Story = { args: { isPlaying: true } };
export const Loading: Story = { args: { isLoading: true } };
export const Muted: Story = { args: { muted: true, volume: 0 } };
export const DoubleSpeed: Story = { args: { playbackRate: 2 } };
export const Theater: Story = { args: { isTheater: true } };
export const Fullscreen: Story = { args: { isFullscreen: true } };
