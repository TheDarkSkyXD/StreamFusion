import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import {
  PLAYER_BUFFERED_RANGES,
  PLAYER_QUALITIES,
  SAFE_PLAYER_POSTER,
} from "../player-story-fixtures";
import { KickPlayerControls } from "./kick-player-controls";

const meta = {
  title: "Components/Player/Kick/KickPlayerControls",
  component: KickPlayerControls,
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
          "The legacy Kick-branded controls surface, including live and VOD presentations.",
      },
    },
  },
  args: {
    isPlaying: false,
    isLoading: false,
    volume: 68,
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
} satisfies Meta<typeof KickPlayerControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PausedVod: Story = {};
export const PlayingVod: Story = { args: { isPlaying: true } };
export const Loading: Story = { args: { isLoading: true } };
export const Muted: Story = { args: { muted: true } };
export const Live: Story = {
  args: {
    currentTime: 0,
    duration: 0,
    onSeek: undefined,
    onPlaybackRateChange: undefined,
  },
};
export const Theater: Story = { args: { isTheater: true } };
export const Fullscreen: Story = { args: { isFullscreen: true } };
