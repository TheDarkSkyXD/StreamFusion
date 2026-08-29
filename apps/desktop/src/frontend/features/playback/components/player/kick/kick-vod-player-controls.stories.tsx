import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import {
  PLAYER_BUFFERED_RANGES,
  PLAYER_QUALITIES,
  SAFE_PLAYER_POSTER,
} from "../player-story-fixtures";
import { KickVodPlayerControls } from "./kick-vod-player-controls";

const meta = {
  title: "Components/Player/Kick/KickVodPlayerControls",
  component: KickVodPlayerControls,
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
    volume: 68,
    muted: false,
    qualities: PLAYER_QUALITIES,
    currentQualityId: "source",
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
} satisfies Meta<typeof KickVodPlayerControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Paused: Story = {};
export const Playing: Story = { args: { isPlaying: true } };
export const Buffering: Story = { args: { isLoading: true } };
export const Muted: Story = { args: { muted: true } };
export const FasterPlayback: Story = { args: { playbackRate: 1.5 } };
