import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SAFE_PLAYER_POSTER } from "../player-story-fixtures";
import { KickHlsPlayer } from "./kick-hls-player";

const meta = {
  title: "Components/Player/Kick/KickHlsPlayer",
  component: KickHlsPlayer,
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
          "The Kick-tuned HLS engine. Its catalog source remains empty so no production CDN is contacted.",
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
} satisfies Meta<typeof KickHlsPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PosterOnly: Story = {};
export const LiveConfiguration: Story = { args: { isLive: true } };
export const NativeControls: Story = { args: { controls: true } };
