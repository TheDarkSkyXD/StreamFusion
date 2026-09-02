import type {
  ActiveStreamRecordingPhase,
  StreamRecordingLifecycleState,
} from "@shared/stream-recording-types";

export const RECORDING_PHASE_LABEL_KEYS: Record<ActiveStreamRecordingPhase, string> = {
  preparing: "mediaLibrary.recordingPhasePreparing",
  recording: "mediaLibrary.recordingPhaseRecording",
  reconnecting: "mediaLibrary.recordingPhaseReconnecting",
  paused: "mediaLibrary.recordingPhasePaused",
  finalizing: "mediaLibrary.recordingPhaseFinalizing",
  interrupted: "mediaLibrary.recordingPhaseInterrupted",
};

export const RECORDING_LIFECYCLE_LABEL_KEYS: Record<
  StreamRecordingLifecycleState["phase"],
  string
> = {
  idle: "mediaLibrary.recordingPhaseIdle",
  ...RECORDING_PHASE_LABEL_KEYS,
  completed: "mediaLibrary.recordingPhaseCompleted",
  partial: "mediaLibrary.recordingPhasePartial",
  failed: "mediaLibrary.recordingPhaseFailed",
};

export function formatCapturedDuration(seconds = 0): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
    : `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}
