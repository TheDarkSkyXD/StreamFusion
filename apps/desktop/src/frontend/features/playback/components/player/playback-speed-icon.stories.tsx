import type { Meta, StoryObj } from "@storybook/react-vite";

import { PlaybackSpeedIcon } from "./playback-speed-icon";

const meta = {
  title: "Components/Player/PlaybackSpeedIcon",
  component: PlaybackSpeedIcon,
  parameters: { layout: "centered" },
  args: {
    className: "h-10 w-10 text-white",
  },
} satisfies Meta<typeof PlaybackSpeedIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const KickContext: Story = {
  args: { className: "h-10 w-10 text-[#53fc18]" },
};
