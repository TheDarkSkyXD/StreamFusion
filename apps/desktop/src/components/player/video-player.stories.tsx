import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SAFE_PLAYER_POSTER } from "./player-story-fixtures";
import { VideoPlayer } from "./video-player";

const meta = {
  title: "Components/Player/VideoPlayer",
  component: VideoPlayer,
  decorators: [
    (Story) => (
      <div className="aspect-video w-[800px] overflow-hidden rounded-xl bg-black">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "centered" },
  args: {
    streamUrl: "",
    platform: "twitch",
    poster: SAFE_PLAYER_POSTER,
    autoPlay: false,
    muted: true,
    onReady: fn(),
    onError: fn(),
    onQualityChange: fn(),
    onToggleTheater: fn(),
  },
} satisfies Meta<typeof VideoPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoSource: Story = {};
export const KickNoSource: Story = { args: { platform: "kick" } };
export const TheaterShell: Story = { args: { isTheater: true } };
