import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { RecordingStopControl } from "./recording-stop-control";
import { makeActiveRecording, withRecordingSnapshot } from "./recording-story-fixtures";

const meta = {
  title: "Components/Recording/Stop Control",
  component: RecordingStopControl,
  parameters: { layout: "centered" },
  args: { surface: "player" },
  argTypes: {
    surface: { control: "inline-radio", options: ["global", "player"] },
  },
  decorators: [
    withRecordingSnapshot({
      active: makeActiveRecording(),
      notice: null,
    }),
  ],
} satisfies Meta<typeof RecordingStopControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Trigger: Story = {};

export const Confirmation: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Stop recording" }));
  },
};
