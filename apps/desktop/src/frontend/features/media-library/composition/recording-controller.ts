import type { RecordingController } from "../capabilities/recording-controller";
import { electronRecordingController } from "../adapters/electron/recording-controller";

/** Resolve the desktop controller when it is needed so late test bridges work too. */
export function getRecordingController(): RecordingController | undefined {
  return (
  typeof window !== "undefined" && window.electronAPI?.streamRecording
    ? electronRecordingController
    : undefined
  );
}
