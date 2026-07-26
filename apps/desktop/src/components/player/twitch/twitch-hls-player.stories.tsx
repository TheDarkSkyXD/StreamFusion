import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SAFE_PLAYER_POSTER } from "../player-story-fixtures";
import { TwitchHlsPlayer } from "./twitch-hls-player";

const meta = {
  title: "Components/Player/Twitch/TwitchHlsPlayer",
  component: TwitchHlsPlayer,
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
          "The Twitch HLS engine and ad-block integration boundary. Catalog stories keep the source empty, so neither HLS nor native media makes a request.",
      },
    },
  },
  args: {
    src: "",
    channelName: "novaarcade",
    poster: SAFE_PLAYER_POSTER,
    autoPlay: false,
    muted: true,
    volume: 0.72,
    currentLevel: "auto",
    enableAdBlock: false,
    onQualityLevels: fn(),
    onError: fn(),
    onHlsInstance: fn(),
    onAdBlockStatusChange: fn(),
    onAdBlockRecoveryRefresh: fn(),
  },
} satisfies Meta<typeof TwitchHlsPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PosterOnly: Story = {};
export const NativeControls: Story = { args: { controls: true } };
export const MutedAtHalfVolume: Story = { args: { volume: 0.5 } };
export const AdBlockBoundaryInitialized: Story = {
  args: { enableAdBlock: true },
  parameters: {
    docs: {
      description: {
        story:
          "Initializes status callbacks with no playback source. No manifest, segment, or Twitch API request is possible.",
      },
    },
  },
};
