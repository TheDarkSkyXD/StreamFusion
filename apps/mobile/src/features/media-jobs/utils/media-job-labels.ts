import type { MediaJobCommandName, MediaJobPhase } from "@streamfusion/core/media-jobs";

export const MEDIA_JOB_COMMAND_BUSY =
  "A Media Job command is already in progress.";
export const MEDIA_JOB_RECOVERY_FAILED =
  "Recovery failed. Recover again to retry.";
export const MEDIA_JOB_DELETED = "Deleted";
export const MEDIA_JOB_OPENED = "Opened";
export const MEDIA_JOB_EXPORT_VERIFIED = "Export verified.";
export const MEDIA_JOB_EXPORT_CANCELLED = "Export cancelled.";
export const MEDIA_JOB_EXPORT_MISMATCH =
  "Export saved but hashes did not match.";

const COMMAND_STATUS_OVERLAYS = new Set([
  MEDIA_JOB_COMMAND_BUSY,
  MEDIA_JOB_RECOVERY_FAILED,
  MEDIA_JOB_DELETED,
  MEDIA_JOB_OPENED,
  MEDIA_JOB_EXPORT_VERIFIED,
  MEDIA_JOB_EXPORT_CANCELLED,
  MEDIA_JOB_EXPORT_MISMATCH,
]);

export function mediaJobDisplayedStatus(
  commandStatus: string | null | undefined,
  snapshotStatus: string,
): string {
  if (isCommandStatusOverlay(commandStatus)) return commandStatus;
  return snapshotStatus;
}

function isCommandStatusOverlay(
  commandStatus: string | null | undefined,
): commandStatus is string {
  return Boolean(commandStatus && COMMAND_STATUS_OVERLAYS.has(commandStatus));
}

export function mediaJobPhaseLabel(phase: MediaJobPhase): string {
  switch (phase) {
    case "queued":
      return "Queued";
    case "preparing":
      return "Preparing";
    case "running":
      return "Running";
    case "pausing":
      return "Pausing";
    case "paused":
      return "Paused";
    case "finalizing":
      return "Finalizing";
    case "completed":
      return "Completed";
    case "failed-retryable":
      return "Failed, retryable";
    case "failed-terminal":
      return "Failed";
    case "canceled":
      return "Canceled";
  }
}

export function mediaJobCommandLabel(
  command: MediaJobCommandName,
  kind: "download" | "recording" = "download",
): string {
  if (kind === "recording" && (command === "finalize" || command === "cancel")) {
    return "Stop";
  }
  switch (command) {
    case "start":
      return "Start";
    case "pause":
      return "Pause";
    case "resume":
      return "Resume";
    case "cancel":
      return "Cancel";
    case "retry":
      return "Retry";
    case "recover":
      return "Recover";
    case "finalize":
      return "Finalize";
  }
}
