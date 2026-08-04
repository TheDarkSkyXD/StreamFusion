import { useCallback } from "react";
import { toast } from "sonner";

import { showErrorToast } from "@/lib/error-toast";
import type {
  StreamRecordingActionResult,
  StreamRecordingRecoveryActionResult,
  StreamRecordingRequest,
  StreamRecordingStartResult,
} from "@/shared/stream-recording-types";

function recoveryBridgeFailure(error: unknown): StreamRecordingRecoveryActionResult {
  return {
    success: false,
    code: "bridge-error",
    error: error instanceof Error ? error.message : "Stream recording is not available",
  };
}

async function invokeRecoveryAction(
  action: () => Promise<StreamRecordingRecoveryActionResult>,
  failureTitle: string
): Promise<StreamRecordingRecoveryActionResult> {
  let result: StreamRecordingRecoveryActionResult;
  try {
    result = await action();
  } catch (error) {
    result = recoveryBridgeFailure(error);
  }
  if (!result.success) showErrorToast(failureTitle, { description: result.error });
  return result;
}

export function useStreamRecordingActions() {
  const start = useCallback(
    async (request: StreamRecordingRequest): Promise<StreamRecordingStartResult | undefined> => {
      const bridge = window.electronAPI?.streamRecording;
      if (!bridge) {
        showErrorToast("Stream recording is not available");
        return;
      }
      const result = await bridge.start(request);
      if (result.outcome === "started") toast.success("Recording started");
      else if (result.outcome === "failed") {
        showErrorToast("Couldn't start recording", { description: result.error });
      }
      return result;
    },
    []
  );

  const pause = useCallback(async (sessionId: string) => {
    const bridge = window.electronAPI?.streamRecording;
    if (!bridge) {
      const result = { success: false, error: "Stream recording is not available" };
      showErrorToast(result.error);
      return result;
    }
    let result: StreamRecordingActionResult;
    try {
      result = await bridge.pause(sessionId);
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : "Stream recording is not available",
      };
    }
    if (!result.success) {
      showErrorToast("Couldn't pause recording", { description: result.error });
    }
    return result;
  }, []);

  const resume = useCallback(async (sessionId: string) => {
    const bridge = window.electronAPI?.streamRecording;
    if (!bridge) {
      const result = { success: false, error: "Stream recording is not available" };
      showErrorToast(result.error);
      return result;
    }
    let result: StreamRecordingActionResult;
    try {
      result = await bridge.resume(sessionId);
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : "Stream recording is not available",
      };
    }
    if (!result.success) {
      showErrorToast("Couldn't resume recording", { description: result.error });
    }
    return result;
  }, []);

  const stop = useCallback(async (sessionId: string) => {
    const bridge = window.electronAPI?.streamRecording;
    if (!bridge) {
      const result = { success: false, error: "Stream recording is not available" };
      showErrorToast(result.error);
      return result;
    }
    const result = await bridge.stop(sessionId);
    if (!result.success) {
      showErrorToast("Couldn't stop recording", { description: result.error });
    }
    return result;
  }, []);

  const discard = useCallback(async (sessionId: string) => {
    const bridge = window.electronAPI?.streamRecording;
    if (!bridge) {
      const result = { success: false, error: "Stream recording is not available" };
      showErrorToast(result.error);
      return result;
    }
    const result = await bridge.discard(sessionId);
    if (!result.success) {
      showErrorToast("Couldn't discard recording", { description: result.error });
    }
    return result;
  }, []);

  const resumeInterrupted = useCallback(async (sessionId: string) => {
    const bridge = window.electronAPI?.streamRecording;
    return invokeRecoveryAction(
      () =>
        bridge
          ? bridge.resumeInterrupted(sessionId)
          : Promise.resolve(recoveryBridgeFailure(undefined)),
      "Couldn't resume recording"
    );
  }, []);

  const finalizeInterrupted = useCallback(async (sessionId: string) => {
    const bridge = window.electronAPI?.streamRecording;
    return invokeRecoveryAction(
      () =>
        bridge
          ? bridge.finalizeInterrupted(sessionId)
          : Promise.resolve(recoveryBridgeFailure(undefined)),
      "Couldn't finalize partial recording"
    );
  }, []);

  const dismissInterrupted = useCallback(async (sessionId: string) => {
    const bridge = window.electronAPI?.streamRecording;
    return invokeRecoveryAction(
      () =>
        bridge
          ? bridge.dismissInterrupted(sessionId, true)
          : Promise.resolve(recoveryBridgeFailure(undefined)),
      "Couldn't dismiss recording recovery"
    );
  }, []);

  const openCompleted = useCallback(async (sessionId: string) => {
    const bridge = window.electronAPI?.streamRecording;
    if (!bridge) return { success: false, error: "Stream recording is not available" };
    const result = await bridge.openCompleted(sessionId);
    if (!result.success) {
      showErrorToast("Couldn't open recording", { description: result.error });
    }
    return result;
  }, []);

  const showCompleted = useCallback(async (sessionId: string) => {
    const bridge = window.electronAPI?.streamRecording;
    if (!bridge) return { success: false, error: "Stream recording is not available" };
    const result = await bridge.showCompleted(sessionId);
    if (!result.success) {
      showErrorToast("Couldn't show recording in folder", { description: result.error });
    }
    return result;
  }, []);

  const dismissNotice = useCallback(async (sessionId: string) => {
    const bridge = window.electronAPI?.streamRecording;
    if (!bridge) return { success: false, error: "Stream recording is not available" };
    return bridge.dismissNotice(sessionId);
  }, []);

  return {
    start,
    pause,
    resume,
    stop,
    discard,
    resumeInterrupted,
    finalizeInterrupted,
    dismissInterrupted,
    openCompleted,
    showCompleted,
    dismissNotice,
  };
}
