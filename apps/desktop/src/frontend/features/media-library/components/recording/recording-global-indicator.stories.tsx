import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@/components/ui/button";

import { RecordingGlobalIndicator } from "./recording-global-indicator";
import { makeActiveRecording, withRecordingSnapshot } from "./recording-story-fixtures";

const meta = {
  title: "Components/Recording/Global Indicator",
  component: RecordingGlobalIndicator,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Persistent recording status shown in the app chrome. Select the pill to inspect session details and controls.",
      },
    },
  },
} satisfies Meta<typeof RecordingGlobalIndicator>;

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

export const PausedWithGap: Story = {
  decorators: [
    withRecordingSnapshot({
      active: makeActiveRecording({
        status: "paused",
        platform: "kick",
        channelName: "MiraMakes",
        capturedDurationSeconds: 812,
        gapCount: 2,
        hasOpenGap: true,
      }),
      notice: null,
    }),
  ],
};

export const QualityChanged: Story = {
  decorators: [
    withRecordingSnapshot({
      active: makeActiveRecording({
        status: "reconnecting",
        qualityLabel: "720p60",
        currentQualityLabel: "720p60",
        qualityChange: {
          revision: 2,
          fromQuality: "1080p60",
          toQuality: "720p60",
        },
      }),
      notice: null,
    }),
  ],
};

export const ComposedControls: Story = {
  args: {
    pauseControl: <Button size="sm">Custom pause</Button>,
    stopControl: <Button size="sm">Custom finish</Button>,
  },
  decorators: [
    withRecordingSnapshot({
      active: makeActiveRecording(),
      notice: null,
    }),
  ],
};
