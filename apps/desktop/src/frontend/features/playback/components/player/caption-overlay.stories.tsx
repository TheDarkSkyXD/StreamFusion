import type { Meta, StoryObj } from "@storybook/react-vite";
import { CaptionOverlay } from "./caption-overlay";
import { SAFE_PLAYER_POSTER } from "./player-story-fixtures";

const meta = {
  title: "Components/Player/CaptionOverlay",
  component: CaptionOverlay,
  decorators: [
    (Story) => (
      <div
        className="relative aspect-video w-[800px] overflow-hidden rounded-xl bg-cover bg-center"
        style={{ backgroundImage: `url("${SAFE_PLAYER_POSTER}")` }}
      >
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Custom timed-text rendering with safe control clearance, positioned WebVTT cues, and local live-word highlighting.",
      },
    },
  },
  args: {
    cues: [
      {
        text: "The stream stays center stage while captions remain readable.",
        startTime: 10,
        endTime: 14,
      },
    ],
  },
} satisfies Meta<typeof CaptionOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StandardCue: Story = {};

export const PositionedCues: Story = {
  args: {
    cues: [
      {
        text: "Top-left speaker label",
        startTime: 4,
        endTime: 8,
        align: "start",
        position: 8,
        positionAlign: "line-left",
        line: 12,
        lineAlign: "start",
        size: 42,
        snapToLines: false,
      },
      {
        text: "Centered lower subtitle",
        startTime: 4,
        endTime: 8,
        align: "center",
        position: 50,
        positionAlign: "center",
        line: 78,
        lineAlign: "center",
        size: 70,
        snapToLines: false,
      },
    ],
  },
};

export const LocalLiveWordHighlight: Story = {
  args: {
    localHighlightColor: "#53fc18",
    cues: [
      {
        text: "Local captions highlight the word being spoken",
        startTime: 21,
        endTime: 24,
        localLive: {
          cueId: "local-1",
          revision: 3,
          isFinal: false,
          words: [
            { text: "Local", startTime: 21, endTime: 21.4 },
            { text: "captions", startTime: 21.4, endTime: 21.9 },
            { text: "highlight", startTime: 21.9, endTime: 22.5 },
            { text: "the", startTime: 22.5, endTime: 22.7 },
            { text: "word", startTime: 22.7, endTime: 23.1 },
            { text: "being", startTime: 23.1, endTime: 23.5 },
            { text: "spoken", startTime: 23.5, endTime: 24 },
          ],
          wordTimingValid: true,
          activeWordIndex: 2,
          fallbackHighlight: false,
        },
      },
    ],
  },
};

export const Empty: Story = {
  args: { cues: [] },
};
