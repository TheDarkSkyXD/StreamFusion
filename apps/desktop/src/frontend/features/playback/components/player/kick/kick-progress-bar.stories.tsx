import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { PLAYER_BUFFERED_RANGES, SAFE_PLAYER_POSTER } from "../player-story-fixtures";
import { KickProgressBar } from "./kick-progress-bar";

const meta = {
  title: "Components/Player/Kick/KickProgressBar",
  component: KickProgressBar,
  decorators: [
    (Story) => (
      <div className="w-[720px] rounded-xl bg-black px-6 py-12">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "centered" },
  args: {
    currentTime: 742,
    duration: 1_800,
    buffered: PLAYER_BUFFERED_RANGES,
    previewImage: SAFE_PLAYER_POSTER,
    onSeek: fn(),
    onSeekHover: fn(),
  },
} satisfies Meta<typeof KickProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vod: Story = {};
export const DvrWindow: Story = {
  args: {
    currentTime: 1_680,
    duration: 1_800,
    seekableRange: { start: 1_200, end: 1_800 },
  },
};
export const AtLiveEdge: Story = {
  args: {
    currentTime: 1_800,
    duration: 1_800,
    isLive: true,
  },
};
export const Empty: Story = {
  args: { currentTime: 0, duration: 0, buffered: undefined },
};
