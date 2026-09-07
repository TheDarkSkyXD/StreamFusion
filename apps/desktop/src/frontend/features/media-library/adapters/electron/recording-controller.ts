import type { RecordingController } from "../../capabilities/recording-controller";

type RecordingBridge = typeof window.electronAPI.streamRecording;

/** Electron implementation of the recording controller port. */
export const electronRecordingController = {
  getState: () => window.electronAPI.streamRecording.getState(),
  start: (...args: Parameters<RecordingBridge["start"]>) =>
    window.electronAPI.streamRecording.start(...args),
  stop: (...args: Parameters<RecordingBridge["stop"]>) =>
    window.electronAPI.streamRecording.stop(...args),
  discard: (...args: Parameters<RecordingBridge["discard"]>) =>
    window.electronAPI.streamRecording.discard(...args),
  pause: (...args: Parameters<RecordingBridge["pause"]>) =>
    window.electronAPI.streamRecording.pause(...args),
  resume: (...args: Parameters<RecordingBridge["resume"]>) =>
    window.electronAPI.streamRecording.resume(...args),
  resumeInterrupted: (...args: Parameters<RecordingBridge["resumeInterrupted"]>) =>
    window.electronAPI.streamRecording.resumeInterrupted(...args),
  finalizeInterrupted: (...args: Parameters<RecordingBridge["finalizeInterrupted"]>) =>
    window.electronAPI.streamRecording.finalizeInterrupted(...args),
  dismissInterrupted: (...args: Parameters<RecordingBridge["dismissInterrupted"]>) =>
    window.electronAPI.streamRecording.dismissInterrupted(...args),
  openCompleted: (...args: Parameters<RecordingBridge["openCompleted"]>) =>
    window.electronAPI.streamRecording.openCompleted(...args),
  showCompleted: (...args: Parameters<RecordingBridge["showCompleted"]>) =>
    window.electronAPI.streamRecording.showCompleted(...args),
  dismissNotice: (...args: Parameters<RecordingBridge["dismissNotice"]>) =>
    window.electronAPI.streamRecording.dismissNotice(...args),
  onStateChanged: (...args: Parameters<RecordingBridge["onStateChanged"]>) =>
    window.electronAPI.streamRecording.onStateChanged(...args),
} satisfies RecordingController;
