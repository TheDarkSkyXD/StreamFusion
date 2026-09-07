import type {
  StreamRecordingActionResult,
  StreamRecordingRecoveryActionResult,
  StreamRecordingRequest,
  StreamRecordingSnapshot,
  StreamRecordingStartResult,
} from "@shared/stream-recording-types";

/** Provider-neutral control surface for a stream recording session. */
export interface RecordingController {
  getState(): Promise<StreamRecordingSnapshot>;
  start(request: StreamRecordingRequest): Promise<StreamRecordingStartResult>;
  stop(sessionId: string): Promise<StreamRecordingActionResult>;
  discard(sessionId: string): Promise<StreamRecordingActionResult>;
  pause(sessionId: string): Promise<StreamRecordingActionResult>;
  resume(sessionId: string): Promise<StreamRecordingActionResult>;
  resumeInterrupted(sessionId: string): Promise<StreamRecordingRecoveryActionResult>;
  finalizeInterrupted(sessionId: string): Promise<StreamRecordingRecoveryActionResult>;
  dismissInterrupted(
    sessionId: string,
    confirmed: boolean
  ): Promise<StreamRecordingRecoveryActionResult>;
  openCompleted(sessionId: string): Promise<StreamRecordingActionResult>;
  showCompleted(sessionId: string): Promise<StreamRecordingActionResult>;
  dismissNotice(sessionId: string): Promise<StreamRecordingActionResult>;
  onStateChanged(callback: (snapshot: StreamRecordingSnapshot) => void): () => void;
}
