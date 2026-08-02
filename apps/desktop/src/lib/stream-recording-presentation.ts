import type {
  ActiveStreamRecordingPhase,
  StreamRecordingLifecycleState,
} from "@/shared/stream-recording-types";

export const RECORDING_PHASE_LABELS: Record<ActiveStreamRecordingPhase, string> = {
  preparing: "Preparing",
  recording: "Recording",
  reconnecting: "Reconnecting",
  paused: "Paused",
  finalizing: "Finalizing",
  interrupted: "Interrupted",
};

export const RECORDING_LIFECYCLE_LABELS: Record<StreamRecordingLifecycleState["phase"], string> = {
  idle: "Idle",
  ...RECORDING_PHASE_LABELS,
  completed: "Completed",
  partial: "Partial recording",
  failed: "Recording failed",
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
