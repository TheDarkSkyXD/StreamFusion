import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import type { AdBlockStatus } from "@/shared/adblock-types";

import { PLAYER_QUALITIES, SAFE_PLAYER_POSTER } from "../player-story-fixtures";
import { TwitchLivePlayerControls } from "./twitch-live-player-controls";

const activeAdBlock: AdBlockStatus = {
  isActive: true,
  isShowingAd: false,
  isMidroll: false,
  isStrippingSegments: false,
  numStrippedSegments: 0,
  activePlayerType: "site",
  channelName: "novaarcade",
  isUsingFallbackMode: false,
  adStartTime: null,
};

const meta = {
  title: "Components/Player/Twitch/TwitchLivePlayerControls",
  component: TwitchLivePlayerControls,
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
    playbackRate: 1,
    adBlockStatus: activeAdBlock,
    onTogglePlay: fn(),
    onVolumeChange: fn(),
    onToggleMute: fn(),
    onQualityChange: fn(),
    onToggleFullscreen: fn(),
    onToggleTheater: fn(),
    onTogglePip: fn(),
    onSeek: fn(),
    onRefresh: fn(),
    onToggleVideoStats: fn(),
  },
} satisfies Meta<typeof TwitchLivePlayerControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Paused: Story = {};
export const Playing: Story = { args: { isPlaying: true } };
export const Loading: Story = { args: { isLoading: true } };
export const Muted: Story = { args: { muted: true, volume: 0 } };
export const AdBlockInactive: Story = {
  args: { adBlockStatus: { ...activeAdBlock, isActive: false } },
};
export const BlockingPreroll: Story = {
  args: {
    adBlockStatus: {
      ...activeAdBlock,
      isShowingAd: true,
      isStrippingSegments: true,
      numStrippedSegments: 4,
      adStartTime: Date.now() - 12_000,
    },
  },
};
export const BlockingMidroll: Story = {
  args: {
    isPlaying: true,
    adBlockStatus: {
      ...activeAdBlock,
      isShowingAd: true,
      isMidroll: true,
      isStrippingSegments: true,
      numStrippedSegments: 11,
      adStartTime: Date.now() - 28_000,
    },
  },
};
export const Fullscreen: Story = { args: { isFullscreen: true } };
