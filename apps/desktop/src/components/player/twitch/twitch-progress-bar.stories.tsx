import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { PLAYER_BUFFERED_RANGES, SAFE_PLAYER_POSTER } from "../player-story-fixtures";
import { TwitchProgressBar } from "./twitch-progress-bar";

const meta = {
  title: "Components/Player/Twitch/TwitchProgressBar",
  component: TwitchProgressBar,
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
} satisfies Meta<typeof TwitchProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BufferedVod: Story = {};
export const NearBeginning: Story = { args: { currentTime: 42 } };
export const Complete: Story = { args: { currentTime: 1_800 } };
export const EmptyDuration: Story = {
  args: { currentTime: 0, duration: 0, buffered: undefined },
};
export const LiveEdge: Story = {
  args: { currentTime: 0, duration: 0, buffered: undefined, isLive: true },
};
