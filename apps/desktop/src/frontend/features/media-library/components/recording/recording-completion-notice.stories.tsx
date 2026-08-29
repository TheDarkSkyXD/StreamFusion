import type { Meta, StoryObj } from "@storybook/react-vite";

import { RecordingOutcomeNotice } from "./recording-completion-notice";
import { makeRecordingNotice } from "./recording-story-fixtures";

const meta = {
  title: "Components/Recording/Outcome Notice",
  component: RecordingOutcomeNotice,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "In-app completion notice for successful, partial, and failed recording outcomes.",
      },
    },
  },
  args: {
    notice: makeRecordingNotice("completed"),
  },
} satisfies Meta<typeof RecordingOutcomeNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Completed: Story = {};

export const TSFallback: Story = {
  args: {
    notice: {
      ...makeRecordingNotice("completed"),
      outputFormat: "ts" as const,
      usedFallback: true,
    },
  },
};

export const Partial: Story = {
  args: { notice: makeRecordingNotice("partial") },
};

export const Failed: Story = {
  args: { notice: makeRecordingNotice("failed") },
};
