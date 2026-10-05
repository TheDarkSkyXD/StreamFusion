import type { Meta, StoryObj } from "@storybook/react-native-web-vite";

import { WatchMockup } from "./watch-mockups";

const meta = {
  title: "Android/Screens/Watch",
  component: WatchMockup,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WatchMockup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Live: Story = { args: { kind: "live" } };
export const SessionPreview: Story = { args: { kind: "guest-chat" } };
export const Video: Story = { args: { kind: "video" } };
export const Clip: Story = { args: { kind: "clip" } };
export const QualitySheet: Story = { args: { kind: "quality" } };
export const Fullscreen: Story = { args: { kind: "fullscreen" } };
export const MiniPlayer: Story = { args: { kind: "mini-player" } };
export const Recording: Story = { args: { kind: "recording" } };
export const PlaybackFailure: Story = { args: { kind: "error" } };
