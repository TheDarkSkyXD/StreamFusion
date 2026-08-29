import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { PerformanceEnhancedPlayer } from "./performance-enhanced-player";
import { SAFE_PLAYER_POSTER } from "./player-story-fixtures";

const meta = {
  title: "Components/Player/PerformanceEnhancedPlayer",
  component: PerformanceEnhancedPlayer,
  decorators: [
    (Story) => (
      <div className="aspect-video w-[800px] overflow-hidden rounded-xl bg-black">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "The adaptive live-player orchestrator. Catalog stories use an empty stream source to avoid live playback while preserving the platform shell.",
      },
    },
  },
  args: {
    platform: "kick",
    streamUrl: "",
    channelName: "storybook-channel",
    poster: SAFE_PLAYER_POSTER,
    autoPlay: false,
    muted: true,
    enableAdaptiveQuality: true,
    enableBackgroundThrottle: true,
    throttleAction: "mute",
    onReady: fn(),
    onError: fn(),
    onQualityChange: fn(),
  },
} satisfies Meta<typeof PerformanceEnhancedPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const KickShell: Story = {};
export const TwitchShell: Story = { args: { platform: "twitch" } };
export const ThrottlingDisabled: Story = {
  args: {
    enableAdaptiveQuality: false,
    enableBackgroundThrottle: false,
  },
};
