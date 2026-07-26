import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { HlsPlayer } from "./hls-player";
import { SAFE_PLAYER_POSTER } from "./player-story-fixtures";

const meta = {
  title: "Components/Player/HlsPlayer",
  component: HlsPlayer,
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
          "The raw media engine. Stories keep the source inert so the catalog never contacts a live HLS CDN.",
      },
    },
  },
  args: {
    src: "",
    poster: SAFE_PLAYER_POSTER,
    autoPlay: false,
    muted: true,
    currentLevel: "auto",
    onQualityLevels: fn(),
    onError: fn(),
  },
} satisfies Meta<typeof HlsPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PosterOnly: Story = {};
export const NativeControls: Story = { args: { controls: true } };
export const LiveConfiguration: Story = { args: { isLive: true } };
