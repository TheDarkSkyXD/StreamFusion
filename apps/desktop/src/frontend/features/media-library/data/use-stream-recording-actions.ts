import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { showErrorToast } from "@/lib/error-toast";
import type {
  StreamRecordingActionResult,
  StreamRecordingRecoveryActionResult,
  StreamRecordingRequest,
  StreamRecordingStartResult,
} from "@shared/stream-recording-types";

function recoveryBridgeFailure(
  error: unknown,
  unavailableMessage: string
): StreamRecordingRecoveryActionResult {
  return {
    success: false,
    code: "bridge-error",
    error: error instanceof Error ? error.message : unavailableMessage,
  };
}

async function invokeRecoveryAction(
  action: () => Promise<StreamRecordingRecoveryActionResult>,
  failureTitle: string,
  unavailableMessage: string
): Promise<StreamRecordingRecoveryActionResult> {
  let result: StreamRecordingRecoveryActionResult;
  try {
    result = await action();
  } catch (error) {
    result = recoveryBridgeFailure(error, unavailableMessage);
  }
  if (!result.success) showErrorToast(failureTitle, { description: result.error });
  return result;
}

export function useStreamRecordingActions() {
  const { t } = useTranslation();
  const start = useCallback(
    async (request: StreamRecordingRequest): Promise<StreamRecordingStartResult | undefined> => {
      const bridge = window.electronAPI?.streamRecording;
      if (!bridge) {
        showErrorToast(t("mediaLibrary.recordingUnavailable"));
        return;
      }
      const result = await bridge.start(request);
      if (result.outcome === "started") toast.success(t("mediaLibrary.recordingStarted"));
      else if (result.outcome === "failed") {
        showErrorToast(t("mediaLibrary.couldNotStartRecording"), { description: result.error });
      }
      return result;
    },
    [t]
  );

  const pause = useCallback(
    async (sessionId: string) => {
      const bridge = window.electronAPI?.streamRecording;
      if (!bridge) {
        const result = { success: false, error: t("mediaLibrary.recordingUnavailable") };
        showErrorToast(result.error);
        return result;
      }
      let result: StreamRecordingActionResult;
      try {
        result = await bridge.pause(sessionId);
      } catch (error) {
        result = {
          success: false,
          error: error instanceof Error ? error.message : t("mediaLibrary.recordingUnavailable"),
        };
      }
      if (!result.success) {
        showErrorToast(t("mediaLibrary.couldNotPauseRecording"), { description: result.error });
      }
      return result;
    },
    [t]
  );

  const resume = useCallback(
    async (sessionId: string) => {
      const bridge = window.electronAPI?.streamRecording;
      if (!bridge) {
        const result = { success: false, error: t("mediaLibrary.recordingUnavailable") };
        showErrorToast(result.error);
        return result;
      }
      let result: StreamRecordingActionResult;
      try {
        result = await bridge.resume(sessionId);
      } catch (error) {
        result = {
          success: false,
          error: error instanceof Error ? error.message : t("mediaLibrary.recordingUnavailable"),
        };
      }
      if (!result.success) {
        showErrorToast(t("mediaLibrary.couldNotResumeRecording"), { description: result.error });
      }
      return result;
    },
    [t]
  );

  const stop = useCallback(
    async (sessionId: string) => {
      const bridge = window.electronAPI?.streamRecording;
      if (!bridge) {
        const result = { success: false, error: t("mediaLibrary.recordingUnavailable") };
        showErrorToast(result.error);
        return result;
      }
      const result = await bridge.stop(sessionId);
      if (!result.success) {
        showErrorToast(t("mediaLibrary.couldNotStopRecording"), { description: result.error });
      }
      return result;
    },
    [t]
  );

  const discard = useCallback(
    async (sessionId: string) => {
      const bridge = window.electronAPI?.streamRecording;
      if (!bridge) {
        const result = { success: false, error: t("mediaLibrary.recordingUnavailable") };
        showErrorToast(result.error);
        return result;
      }
      const result = await bridge.discard(sessionId);
      if (!result.success) {
        showErrorToast(t("mediaLibrary.couldNotDiscardRecording"), { description: result.error });
      }
      return result;
    },
    [t]
  );

  const resumeInterrupted = useCallback(
    async (sessionId: string) => {
      const bridge = window.electronAPI?.streamRecording;
      return invokeRecoveryAction(
        () =>
          bridge
            ? bridge.resumeInterrupted(sessionId)
            : Promise.resolve(
                recoveryBridgeFailure(undefined, t("mediaLibrary.recordingUnavailable"))
              ),
        t("mediaLibrary.couldNotResumeRecording"),
        t("mediaLibrary.recordingUnavailable")
      );
    },
    [t]
  );

  const finalizeInterrupted = useCallback(
    async (sessionId: string) => {
      const bridge = window.electronAPI?.streamRecording;
      return invokeRecoveryAction(
        () =>
          bridge
            ? bridge.finalizeInterrupted(sessionId)
            : Promise.resolve(
                recoveryBridgeFailure(undefined, t("mediaLibrary.recordingUnavailable"))
              ),
        t("mediaLibrary.couldNotFinalizeRecording"),
        t("mediaLibrary.recordingUnavailable")
      );
    },
    [t]
  );

  const dismissInterrupted = useCallback(
    async (sessionId: string) => {
      const bridge = window.electronAPI?.streamRecording;
      return invokeRecoveryAction(
        () =>
          bridge
            ? bridge.dismissInterrupted(sessionId, true)
            : Promise.resolve(
                recoveryBridgeFailure(undefined, t("mediaLibrary.recordingUnavailable"))
              ),
        t("mediaLibrary.couldNotDismissRecovery"),
        t("mediaLibrary.recordingUnavailable")
      );
    },
    [t]
  );

  const openCompleted = useCallback(
    async (sessionId: string) => {
      const bridge = window.electronAPI?.streamRecording;
      if (!bridge) return { success: false, error: t("mediaLibrary.recordingUnavailable") };
      const result = await bridge.openCompleted(sessionId);
      if (!result.success) {
        showErrorToast(t("mediaLibrary.couldNotOpenRecording"), { description: result.error });
      }
      return result;
    },
    [t]
  );

  const showCompleted = useCallback(
    async (sessionId: string) => {
      const bridge = window.electronAPI?.streamRecording;
      if (!bridge) return { success: false, error: t("mediaLibrary.recordingUnavailable") };
      const result = await bridge.showCompleted(sessionId);
      if (!result.success) {
        showErrorToast(t("mediaLibrary.couldNotShowRecording"), { description: result.error });
      }
      return result;
    },
    [t]
  );

  const dismissNotice = useCallback(
    async (sessionId: string) => {
      const bridge = window.electronAPI?.streamRecording;
      if (!bridge) return { success: false, error: t("mediaLibrary.recordingUnavailable") };
      return bridge.dismissNotice(sessionId);
    },
    [t]
  );

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
