import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { PlayerToolsMockup } from "./player-tools-mockups";

const meta = {
  title: "Android/Proposed/Player tools",
  component: PlayerToolsMockup,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PlayerToolsMockup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const PlaybackSpeedSheet: Story = { args: { kind: "speed" } };
export const VideoStatsSheet: Story = { args: { kind: "stats" } };
export const VolumeControls: Story = { args: { kind: "volume" } };
