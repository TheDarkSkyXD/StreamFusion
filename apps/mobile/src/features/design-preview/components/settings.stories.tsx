import type { Meta, StoryObj } from "@storybook/react-native-web-vite";

import { SettingsMockup } from "./settings-mockups";

const meta = {
  title: "Android/Screens/Settings",
  component: SettingsMockup,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SettingsMockup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Hub: Story = { args: { panel: "hub" } };
export const Appearance: Story = { args: { panel: "appearance" } };
export const Playback: Story = { args: { panel: "playback" } };
export const PlayerControls: Story = { args: { panel: "player-controls" } };
export const Buffer: Story = { args: { panel: "buffer" } };
export const Chat: Story = { args: { panel: "chat" } };
export const Predictions: Story = { args: { panel: "predictions" } };
export const Notifications: Story = { args: { panel: "notifications" } };
export const AdBlocking: Story = { args: { panel: "adblock" } };
export const Proxy: Story = { args: { panel: "proxy" } };
export const Integrations: Story = { args: { panel: "integrations" } };
export const ApiTokens: Story = { args: { panel: "api-tokens" } };
export const Updates: Story = { args: { panel: "updates" } };
export const Diagnostics: Story = { args: { panel: "diagnostics" } };
export const Logs: Story = { args: { panel: "logs" } };
export const ReportBug: Story = { args: { panel: "report-bug" } };
export const About: Story = { args: { panel: "about" } };
