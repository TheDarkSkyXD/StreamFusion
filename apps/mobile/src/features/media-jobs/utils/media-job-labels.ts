import type { MediaJobCommandName, MediaJobPhase } from "@streamfusion/core/media-jobs";

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

export function mediaJobCommandLabel(command: MediaJobCommandName): string {
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
