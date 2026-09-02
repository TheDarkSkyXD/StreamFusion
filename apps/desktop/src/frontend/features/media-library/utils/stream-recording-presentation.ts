import type {
  ActiveStreamRecordingPhase,
  StreamRecordingLifecycleState,
} from "@shared/stream-recording-types";
import type { mediaLibraryEn } from "@/i18n/locales/en/mediaLibrary";

type MediaLibraryTranslationKey =
  `mediaLibrary.${keyof typeof mediaLibraryEn.mediaLibrary & string}`;

export const RECORDING_PHASE_LABEL_KEYS = {
  preparing: "mediaLibrary.recordingPhasePreparing",
  recording: "mediaLibrary.recordingPhaseRecording",
  reconnecting: "mediaLibrary.recordingPhaseReconnecting",
  paused: "mediaLibrary.recordingPhasePaused",
  finalizing: "mediaLibrary.recordingPhaseFinalizing",
  interrupted: "mediaLibrary.recordingPhaseInterrupted",
} as const satisfies Record<ActiveStreamRecordingPhase, MediaLibraryTranslationKey>;

export const RECORDING_LIFECYCLE_LABEL_KEYS = {
  idle: "mediaLibrary.recordingPhaseIdle",
  ...RECORDING_PHASE_LABEL_KEYS,
  completed: "mediaLibrary.recordingPhaseCompleted",
  partial: "mediaLibrary.recordingPhasePartial",
  failed: "mediaLibrary.recordingPhaseFailed",
} as const satisfies Record<StreamRecordingLifecycleState["phase"], MediaLibraryTranslationKey>;

export function formatCapturedDuration(seconds = 0): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
    : `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}
