import type { Meta, StoryObj } from "@storybook/react-vite";

import { RecordingSessionControls } from "./recording-session-control";
import { makeActiveRecording, withRecordingSnapshot } from "./recording-story-fixtures";

const meta = {
  title: "Components/Recording/Session Controls",
  component: RecordingSessionControls,
  parameters: { layout: "centered" },
  args: { surface: "player" },
  argTypes: {
    surface: { control: "inline-radio", options: ["global", "player"] },
  },
} satisfies Meta<typeof RecordingSessionControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Recording: Story = {
  decorators: [
    withRecordingSnapshot({
      active: makeActiveRecording(),
      notice: null,
    }),
  ],
};

export const Paused: Story = {
  decorators: [
    withRecordingSnapshot({
      active: makeActiveRecording({ status: "paused" }),
      notice: null,
    }),
  ],
};

export const Resuming: Story = {
  decorators: [
    withRecordingSnapshot({
      active: makeActiveRecording({ status: "preparing", statusMessage: "Resuming" }),
      notice: null,
    }),
  ],
};
