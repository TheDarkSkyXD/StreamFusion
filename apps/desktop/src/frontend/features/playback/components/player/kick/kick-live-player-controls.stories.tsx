import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { PLAYER_QUALITIES, SAFE_PLAYER_POSTER } from "../player-story-fixtures";
import { KickLivePlayerControls } from "./kick-live-player-controls";

const meta = {
  title: "Components/Player/Kick/KickLivePlayerControls",
  component: KickLivePlayerControls,
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
    currentQualityId: "auto",
    isFullscreen: false,
    isTheater: false,
    playbackRate: 1,
    onTogglePlay: fn(),
    onVolumeChange: fn(),
    onToggleMute: fn(),
    onQualityChange: fn(),
    onToggleFullscreen: fn(),
    onToggleTheater: fn(),
    onTogglePip: fn(),
    onSeek: fn(),
    onGoLive: fn(),
  },
} satisfies Meta<typeof KickLivePlayerControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PausedAtLiveEdge: Story = {};
export const Playing: Story = { args: { isPlaying: true } };
export const Loading: Story = { args: { isLoading: true } };
export const Muted: Story = { args: { muted: true } };
export const Fullscreen: Story = { args: { isFullscreen: true } };
