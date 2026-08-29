import type { Decorator } from "@storybook/react-vite";
import { createElement } from "react";

import { StreamRecordingProvider } from "@/features/media-library/data/use-stream-recording-state";
import type {
  ActiveStreamRecording,
  StreamRecordingNotice,
  StreamRecordingSnapshot,
} from "@shared/stream-recording-types";

const baseActiveRecording: ActiveStreamRecording = {
  sessionId: "recording-session-story",
  platform: "twitch",
  channelName: "NovaArcade",
  title: "Road to radiant with calm comms",
  status: "recording",
  qualityLabel: "1080p60",
  desiredQualityLabel: "1080p60",
  currentQualityLabel: "1080p60",
  capturedDurationSeconds: 4_327,
  gapCount: 0,
  hasOpenGap: false,
};

export function makeActiveRecording(
  overrides: Partial<ActiveStreamRecording> = {}
): ActiveStreamRecording {
  return { ...baseActiveRecording, ...overrides };
}

export function makeRecordingNotice(
  outcome: "completed"
): Extract<StreamRecordingNotice, { outcome: "completed" }>;
export function makeRecordingNotice(
  outcome: "partial"
): Extract<StreamRecordingNotice, { outcome: "partial" }>;
export function makeRecordingNotice(
  outcome: "failed"
): Extract<StreamRecordingNotice, { outcome: "failed" }>;
export function makeRecordingNotice(
  outcome: "completed" | "partial" | "failed"
): StreamRecordingNotice {
  const shared = {
    sessionId: `recording-${outcome}-story`,
    platform: "kick" as const,
    channelName: "MiraMakes",
    title: "Building a tiny fantasy city",
    delivery: "in-app" as const,
  };

  if (outcome === "failed") {
    return {
      ...shared,
      outcome,
      error: "The stream ended before a playable section could be finalized.",
    };
  }

  return {
    ...shared,
    outcome,
    outputPath: `C:\\Videos\\MiraMakes-${outcome}.mp4`,
    outputFormat: "mp4",
    artifactIdentity: {
      algorithm: "sha256",
      digest: "storybook-recording-artifact",
      size: 1_048_576,
    },
    ...(outcome === "partial"
      ? { error: "The final reconnect could not be recovered; earlier footage is safe." }
      : {}),
  };
}

export function withRecordingSnapshot(snapshot: StreamRecordingSnapshot): Decorator {
  return (Story) => {
    const bridge = window.electronAPI.streamRecording;
    bridge.getState = async () => snapshot;
    bridge.onStateChanged = () => () => undefined;
    bridge.pause = async () => ({ success: true });
    bridge.resume = async () => ({ success: true });
    bridge.stop = async () => ({ success: true });
    bridge.resumeInterrupted = async () => ({ success: true });
    bridge.finalizeInterrupted = async () => ({ success: true });
    bridge.dismissInterrupted = async () => ({ success: true });
    bridge.openCompleted = async () => ({ success: true });
    bridge.showCompleted = async () => ({ success: true });
    bridge.dismissNotice = async () => ({ success: true });

    return createElement(StreamRecordingProvider, null, createElement(Story));
  };
}
