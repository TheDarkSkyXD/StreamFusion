import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { CaptionErrorNotice } from "./caption-error-notice";

const meta = {
  title: "Components/Player/CaptionErrorNotice",
  component: CaptionErrorNotice,
  decorators: [
    (Story) => (
      <div className="relative h-64 w-[720px] overflow-hidden rounded-xl bg-[#0f0f0f]">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: "A recoverable caption failure notice positioned above player controls.",
      },
    },
  },
  args: {
    error: {
      failedTrackKey: "hls:0",
      message: "Captions stopped loading.",
    },
    onRetry: fn(),
  },
} satisfies Meta<typeof CaptionErrorNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RecoverableError: Story = {};

export const LongMessage: Story = {
  args: {
    error: {
      failedTrackKey: "local-live:en",
      message: "Local captions lost access to the audio track. Retry when playback resumes.",
    },
  },
};

export const HiddenWithoutError: Story = {
  args: { error: null },
};
