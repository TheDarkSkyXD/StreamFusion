import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useLayoutEffect } from "react";
import { userEvent, within } from "storybook/test";

import { withAppRouter } from "../../../.storybook/story-router";
import { StreamRecordingProvider } from "@/hooks/use-stream-recording-state";
import type { ElectronAPI } from "@/preload";
import type {
  StreamRecordingSnapshot,
  StreamRecordingStartResult,
} from "@/shared/stream-recording-types";

import { StreamRecordingControl } from "./stream-recording-control";
import { makeActiveRecording } from "./recording-story-fixtures";

const readySnapshot = { active: null, notice: null } satisfies StreamRecordingSnapshot;

function RecordingBridgeProvider({
  children,
  streamRecording,
}: {
  children: ReactNode;
  streamRecording: ElectronAPI["streamRecording"];
}) {
  useLayoutEffect(() => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
    const previousBridge = window.electronAPI;
    const electronApi = Object.create(previousBridge) as ElectronAPI;
    Object.defineProperty(electronApi, "streamRecording", { value: streamRecording });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: electronApi,
    });

    return () => {
      if (previousDescriptor) Object.defineProperty(window, "electronAPI", previousDescriptor);
      else Reflect.deleteProperty(window, "electronAPI");
    };
  }, [streamRecording]);

  return <StreamRecordingProvider>{children}</StreamRecordingProvider>;
}

function withRecordingBridge({
  snapshot,
  start = async () => ({ success: true, outcome: "started", sessionId: "recording-story" }),
}: {
  snapshot: StreamRecordingSnapshot;
  start?: () => Promise<StreamRecordingStartResult>;
}): Decorator {
  return (Story) => {
    const streamRecording: ElectronAPI["streamRecording"] = {
      getState: async () => snapshot,
      start,
      stop: async () => ({ success: true }),
      discard: async () => ({ success: true }),
      pause: async () => ({ success: true }),
      resume: async () => ({ success: true }),
      resumeInterrupted: async () => ({ success: true }),
      finalizeInterrupted: async () => ({ success: true }),
      dismissInterrupted: async () => ({ success: true }),
      openCompleted: async () => ({ success: true }),
      showCompleted: async () => ({ success: true }),
      dismissNotice: async () => ({ success: true }),
      onStateChanged: () => () => undefined,
    };

    return (
      <RecordingBridgeProvider streamRecording={streamRecording}>
        <Story />
      </RecordingBridgeProvider>
    );
  };
}

const meta = {
  title: "Components/Recording/Stream Recording Control",
  component: StreamRecordingControl,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Watch-page entry control for direct-to-file stream recording. It is intentionally absent when playback is unavailable.",
      },
    },
  },
  args: {
    platform: "twitch",
    channelName: "NovaArcade",
    streamId: "twitch-stream-story-123",
    title: "Road to radiant with calm comms",
    isPlayable: true,
  },
  decorators: [withAppRouter],
} satisfies Meta<typeof StreamRecordingControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyToRecord: Story = {
  decorators: [withRecordingBridge({ snapshot: readySnapshot })],
};

export const QualitySelection: Story = {
  decorators: [withRecordingBridge({ snapshot: readySnapshot })],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Record stream" }));
  },
};

export const StartingRecording: Story = {
  decorators: [
    withRecordingBridge({
      snapshot: readySnapshot,
      start: () => new Promise<StreamRecordingStartResult>(() => undefined),
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Record stream" }));
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole("button", {
        name: "Choose save location",
      })
    );
  },
};

export const CurrentStreamRecording: Story = {
  decorators: [
    withRecordingBridge({
      snapshot: {
        active: makeActiveRecording({
          platform: "twitch",
          channelName: "NovaArcade",
          capturedDurationSeconds: 4_327,
        }),
        notice: null,
      },
    }),
  ],
};

export const ActiveRecordingConflict: Story = {
  decorators: [
    withRecordingBridge({
      snapshot: readySnapshot,
      start: async () => ({
        success: false,
        outcome: "blocked",
        code: "stream-recording-active",
        error: "A Stream Recording is already active",
        activeRecording: makeActiveRecording({
          platform: "kick",
          channelName: "MiraMakes",
          title: "Building a tiny fantasy city",
        }),
      }),
    }),
  ],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Record stream" }));
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole("button", {
        name: "Choose save location",
      })
    );
  },
};

export const UnavailableStream: Story = {
  args: { isPlayable: false },
  decorators: [withRecordingBridge({ snapshot: readySnapshot })],
  parameters: {
    docs: {
      description: {
        story: "The control intentionally renders nothing until a stream has playable media.",
      },
    },
  },
};
