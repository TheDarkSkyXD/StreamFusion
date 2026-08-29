import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { VolumeControl } from "./volume-control";

const meta = {
  title: "Components/Player/VolumeControl",
  component: VolumeControl,
  decorators: [
    (Story) => (
      <div className="min-w-56 rounded-xl bg-black p-6">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "centered" },
  args: {
    volume: 72,
    muted: false,
    onVolumeChange: fn(),
    onMuteToggle: fn(),
  },
} satisfies Meta<typeof VolumeControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loud: Story = {};
export const Quiet: Story = { args: { volume: 24 } };
export const Muted: Story = { args: { muted: true } };
export const ZeroVolume: Story = { args: { volume: 0 } };
