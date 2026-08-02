import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { RecordingRecoveryDialog } from "./recording-recovery-dialog";
import { makeActiveRecording, withRecordingSnapshot } from "./recording-story-fixtures";

const meta = {
  title: "Components/Recording/Recovery Dialog",
  component: RecordingRecoveryDialog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RecordingRecoveryDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interrupted: Story = {
  decorators: [
    withRecordingSnapshot({
      active: makeActiveRecording({
        status: "interrupted",
        platform: "kick",
        channelName: "MiraMakes",
        title: "Building a tiny fantasy city",
        desiredQualityLabel: "1080p60",
        currentQualityLabel: "720p60",
        capturedDurationSeconds: 2_785,
        gapCount: 2,
        hasOpenGap: true,
      }),
      notice: null,
    }),
  ],
};

export const FinalizeOnly: Story = {
  decorators: [
    withRecordingSnapshot({
      active: makeActiveRecording({
        status: "interrupted",
        recoveryFinalizeOnly: true,
        recoveryResumeEligible: false,
        recoveryResumeUnavailableReason: "finalization-checkpoint",
        statusMessage: "Finalization checkpoint recovered",
      }),
      notice: null,
    }),
  ],
};

export const DismissConfirmation: Story = {
  decorators: [
    withRecordingSnapshot({
      active: makeActiveRecording({ status: "interrupted" }),
      notice: null,
    }),
  ],
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole("button", {
        name: "Dismiss recovery",
      })
    );
  },
};
