import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useMemo, useRef } from "react";

import { StreamRecordingProvider } from "@/hooks/use-stream-recording-state";
import type {
  StreamRecordingSnapshot,
  StreamRecordingStatus,
} from "@/shared/stream-recording-types";

import { RecordingPlayerStatus } from "./recording-player-status";

function RecordingBridgeFixture({
  status,
  gapCount = 0,
  hasOpenGap = false,
  qualityChange = null,
  children,
}: {
  status: StreamRecordingStatus;
  gapCount?: number;
  hasOpenGap?: boolean;
  qualityChange?: { revision: number; fromQuality: string; toQuality: string } | null;
  children: React.ReactNode;
}) {
  const originalApiRef = useRef(window.electronAPI);
  const snapshot = useMemo<StreamRecordingSnapshot>(
    () => ({
      active: {
        sessionId: "storybook-recording",
        platform: "kick",
        channelName: "pixelnomad",
        title: "Storybook live session",
        status,
        qualityLabel: qualityChange?.toQuality ?? "1080p60",
        currentQualityLabel: qualityChange?.toQuality ?? "1080p60",
        desiredQualityLabel: "Source",
        qualityChange,
        capturedDurationSeconds: 1_122,
        gapCount,
        hasOpenGap,
      },
      notice: null,
    }),
    [gapCount, hasOpenGap, qualityChange, status]
  );
  const storyApi = useMemo(
    () =>
      new Proxy(originalApiRef.current, {
        get(target, property, receiver) {
          if (property === "streamRecording") {
            return {
              getState: async () => snapshot,
              onStateChanged: () => () => {},
            };
          }
          return Reflect.get(target, property, receiver);
        },
      }),
    [snapshot]
  );

  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: storyApi,
  });

  useEffect(
    () => () => {
      Object.defineProperty(window, "electronAPI", {
        configurable: true,
        value: originalApiRef.current,
      });
    },
    []
  );

  return children;
}

const meta = {
  title: "Components/Player/RecordingPlayerStatus",
  component: RecordingPlayerStatus,
  decorators: [
    (Story) => (
      <StreamRecordingProvider>
        <div className="relative h-48 w-[800px] overflow-hidden rounded-xl bg-black">
          <Story />
        </div>
      </StreamRecordingProvider>
    ),
  ],
  parameters: { layout: "centered" },
  args: {
    platform: "kick",
    channelName: "pixelnomad",
    mode: "normal",
  },
  render: (args) => (
    <RecordingBridgeFixture status="recording">
      <RecordingPlayerStatus {...args} />
    </RecordingBridgeFixture>
  ),
} satisfies Meta<typeof RecordingPlayerStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Recording: Story = {};

export const Preparing: Story = {
  render: (args) => (
    <RecordingBridgeFixture status="preparing">
      <RecordingPlayerStatus {...args} />
    </RecordingBridgeFixture>
  ),
};

export const ReconnectingWithGap: Story = {
  render: (args) => (
    <RecordingBridgeFixture status="reconnecting" gapCount={2} hasOpenGap>
      <RecordingPlayerStatus {...args} />
    </RecordingBridgeFixture>
  ),
};

export const QualityChanged: Story = {
  render: (args) => (
    <RecordingBridgeFixture
      status="recording"
      qualityChange={{ revision: 2, fromQuality: "Source", toQuality: "720p60" }}
    >
      <RecordingPlayerStatus {...args} />
    </RecordingBridgeFixture>
  ),
};

export const Fullscreen: Story = {
  args: { mode: "fullscreen" },
};
