import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { PlayPauseButton } from "./play-pause-button";

const meta = {
  title: "Components/Player/PlayPauseButton",
  component: PlayPauseButton,
  decorators: [
    (Story) => (
      <div className="rounded-full bg-black p-3">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "centered" },
  args: {
    isPlaying: false,
    isLoading: false,
    onToggle: fn(),
  },
} satisfies Meta<typeof PlayPauseButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Paused: Story = {};
export const Playing: Story = { args: { isPlaying: true } };
export const Loading: Story = { args: { isLoading: true } };
