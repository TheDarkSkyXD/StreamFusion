import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type {
  StreamRecordingRecoveryActionResult,
  StreamRecordingRequest,
} from "@shared/stream-recording-types";
import { getDefaultStreamRecordingService } from "../../services/stream-recording-default-service";
import { getStreamRecordingSessionStore } from "../../services/stream-recording-session-store";
import { isAllowedSender } from "../sender-origin";
import type { MainRendererPort } from "../main-renderer-port";
import { registerLoadedFeatureCleanup } from "../../startup/loaded-feature-cleanup";

function sessionId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as { sessionId?: unknown }).sessionId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isStreamRecordingRequest(payload: unknown): payload is StreamRecordingRequest {
  if (!payload || typeof payload !== "object") return false;
  const request = payload as Partial<StreamRecordingRequest>;
  return (
    (request.platform === "twitch" || request.platform === "kick") &&
    typeof request.channelName === "string" &&
    request.channelName.trim().length > 0 &&
    typeof request.streamId === "string" &&
    request.streamId.trim().length > 0 &&
    typeof request.title === "string" &&
    request.title.trim().length > 0
  );
}

const REJECTED_ERROR = "Rejected: caller is not the application renderer.";

function recoveryBridgeError(error: string): StreamRecordingRecoveryActionResult {
  return { success: false, code: "bridge-error", error };
}

export function registerStreamRecordingHandlers(renderer: MainRendererPort): void {
  const service = getDefaultStreamRecordingService(renderer);
  const unsubscribe = getStreamRecordingSessionStore().subscribe((snapshot) => {
    renderer.send(IPC_CHANNELS.STREAM_RECORDING_STATE_CHANGED, snapshot);
  });
  registerLoadedFeatureCleanup("stream-recording:state-events", unsubscribe);

  ipcMain.handle(IPC_CHANNELS.STREAM_RECORDING_GET_STATE, (event) =>
    isAllowedSender(event) ? service.getSnapshot() : { active: null, notice: null }
  );
  ipcMain.handle(IPC_CHANNELS.STREAM_RECORDING_START, (event, request: unknown) => {
    if (!isAllowedSender(event)) {
      return { success: false, outcome: "failed", error: REJECTED_ERROR };
    }
    return isStreamRecordingRequest(request)
      ? service.startRecording(request)
      : { success: false, outcome: "failed", error: "Invalid Stream Recording request" };
  });
  ipcMain.handle(IPC_CHANNELS.STREAM_RECORDING_STOP, (event, payload) => {
    if (!isAllowedSender(event)) return { success: false, error: REJECTED_ERROR };
    const id = sessionId(payload);
    return id ? service.stopRecording(id) : { success: false, error: "sessionId is required" };
  });
  ipcMain.handle(IPC_CHANNELS.STREAM_RECORDING_DISCARD, (event, payload) => {
    if (!isAllowedSender(event)) return { success: false, error: REJECTED_ERROR };
    const id = sessionId(payload);
    return id ? service.discardRecording(id) : { success: false, error: "sessionId is required" };
  });
  ipcMain.handle(IPC_CHANNELS.STREAM_RECORDING_PAUSE, (event, payload) => {
    if (!isAllowedSender(event)) return { success: false, error: REJECTED_ERROR };
    const id = sessionId(payload);
    return id ? service.pauseRecording(id) : { success: false, error: "sessionId is required" };
  });
  ipcMain.handle(IPC_CHANNELS.STREAM_RECORDING_RESUME, (event, payload) => {
    if (!isAllowedSender(event)) return { success: false, error: REJECTED_ERROR };
    const id = sessionId(payload);
    return id ? service.resumeRecording(id) : { success: false, error: "sessionId is required" };
  });
  ipcMain.handle(IPC_CHANNELS.STREAM_RECORDING_RESUME_INTERRUPTED, (event, payload) => {
    if (!isAllowedSender(event)) return recoveryBridgeError(REJECTED_ERROR);
    const id = sessionId(payload);
    return id ? service.resumeInterrupted(id) : recoveryBridgeError("sessionId is required");
  });
  ipcMain.handle(IPC_CHANNELS.STREAM_RECORDING_FINALIZE_INTERRUPTED, (event, payload) => {
    if (!isAllowedSender(event)) return recoveryBridgeError(REJECTED_ERROR);
    const id = sessionId(payload);
    return id ? service.finalizeInterrupted(id) : recoveryBridgeError("sessionId is required");
  });
  ipcMain.handle(IPC_CHANNELS.STREAM_RECORDING_DISMISS_INTERRUPTED, (event, payload) => {
    if (!isAllowedSender(event)) return recoveryBridgeError(REJECTED_ERROR);
    const id = sessionId(payload);
    const confirmed =
      typeof payload === "object" &&
      payload !== null &&
      (payload as { confirmed?: unknown }).confirmed === true;
    return id
      ? service.dismissInterrupted(id, confirmed)
      : recoveryBridgeError("sessionId is required");
  });
  ipcMain.handle(IPC_CHANNELS.STREAM_RECORDING_OPEN_COMPLETED, (event, payload) => {
    if (!isAllowedSender(event)) return { success: false, error: REJECTED_ERROR };
    const id = sessionId(payload);
    return id
      ? service.openCompletedRecording(id)
      : { success: false, error: "sessionId is required" };
  });
  ipcMain.handle(IPC_CHANNELS.STREAM_RECORDING_SHOW_COMPLETED, (event, payload) => {
    if (!isAllowedSender(event)) return { success: false, error: REJECTED_ERROR };
    const id = sessionId(payload);
    return id
      ? service.showCompletedRecording(id)
      : { success: false, error: "sessionId is required" };
  });
  ipcMain.handle(IPC_CHANNELS.STREAM_RECORDING_DISMISS_NOTICE, (event, payload) => {
    if (!isAllowedSender(event)) return { success: false, error: REJECTED_ERROR };
    const id = sessionId(payload);
    return id ? service.dismissNotice(id) : { success: false, error: "sessionId is required" };
  });
}
