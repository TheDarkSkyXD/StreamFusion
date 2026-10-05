import type { Meta, StoryObj } from "@storybook/react-native-web-vite";

import { LibraryMockup } from "./library-mockups";

const meta = {
  title: "Android/Screens/Library and activity",
  component: LibraryMockup,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LibraryMockup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const More: Story = { args: { kind: "more" } };
export const History: Story = { args: { kind: "history" } };
export const HistoryEmpty: Story = {
  args: { kind: "history", phase: "empty" },
};
export const HistoryError: Story = {
  args: { kind: "history", phase: "error" },
};
export const Downloads: Story = { args: { kind: "downloads" } };
export const DownloadsOffline: Story = {
  args: { kind: "downloads", phase: "offline" },
};
export const DownloadDetail: Story = { args: { kind: "job" } };
export const Activity: Story = { args: { kind: "activity" } };
export const ActivityEmpty: Story = {
  args: { kind: "activity", phase: "empty" },
};
export const ActivityDetail: Story = { args: { kind: "activity-detail" } };
export const DiagnosticsWorkspace: Story = { args: { kind: "diagnostics" } };
export const ModerationPlaceholder: Story = {
  args: { kind: "moderation-placeholder" },
};
