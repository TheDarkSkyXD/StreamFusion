import type {
  StreamRecordingArtifactIdentity,
  StreamRecordingNotice,
} from "@shared/stream-recording-types";
import type { StreamRecordingSessionStore } from "./stream-recording-session-store";

export interface StreamRecordingDeliveryContext {
  visible: boolean;
  focused: boolean;
  minimized: boolean;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  nativeSupported: boolean;
}

export interface StreamRecordingOutcomeCoordinator {
  settle(sessionId: string, notice: StreamRecordingNotice): boolean;
  getCurrentNotice(sessionId?: string): StreamRecordingNotice | null;
  open(sessionId: string): Promise<{ success: boolean; error?: string }>;
  show(sessionId: string): Promise<{ success: boolean; error?: string }>;
  dismiss(sessionId: string): boolean;
}

export function createStreamRecordingOutcomeCoordinator({
  sessionStore,
  getDeliveryContext,
  showNative,
  focusWindow,
  scheduleClear,
  recordingFileActions,
  verifyArtifactIdentity,
  noticeTtlMs = 10_000,
}: {
  sessionStore: StreamRecordingSessionStore;
  getDeliveryContext: () => StreamRecordingDeliveryContext;
  showNative: (input: {
    title: string;
    body: string;
    silent: boolean;
    onClick: () => void;
  }) => void;
  focusWindow: () => void;
  recordingFileActions: {
    exists(path: string): boolean;
    openPath(path: string): Promise<string>;
    showItemInFolder(path: string): void;
  };
  verifyArtifactIdentity: (
    path: string,
    identity: StreamRecordingArtifactIdentity
  ) => Promise<boolean>;
  scheduleClear: (callback: () => void, delayMs: number) => unknown;
  noticeTtlMs?: number;
}): StreamRecordingOutcomeCoordinator {
  function actionError(error: unknown, fallback: string): { success: false; error: string } {
    return { success: false, error: error instanceof Error ? error.message : fallback };
  }

  function getCurrentNotice(sessionId?: string): StreamRecordingNotice | null {
    const notice = sessionStore.getSnapshot().notice;
    return notice && (!sessionId || notice.sessionId === sessionId) ? notice : null;
  }

  async function ownedOutputPath(sessionId: string): Promise<{ path: string } | { error: string }> {
    const notice = getCurrentNotice(sessionId);
    if (!notice || notice.outcome === "failed") return { error: "Recording outcome not found" };
    if (!recordingFileActions.exists(notice.outputPath))
      return { error: "Recording file not found" };
    if (!(await verifyArtifactIdentity(notice.outputPath, notice.artifactIdentity))) {
      return { error: "Recording file ownership could not be verified" };
    }
    return { path: notice.outputPath };
  }

  return {
    getCurrentNotice,
    settle(sessionId, notice) {
      const context = getDeliveryContext();
      const delivery =
        context.visible && context.focused && !context.minimized
          ? "in-app"
          : context.notificationsEnabled && context.nativeSupported
            ? "native"
            : "none";
      const deliveredNotice: StreamRecordingNotice = { ...notice, delivery };
      const settled = sessionStore.settle(sessionId, deliveredNotice);
      if (!settled) return false;
      scheduleClear(() => {
        sessionStore.dismissNotice(sessionId);
      }, noticeTtlMs);
      if (delivery !== "native") return true;

      let promoted = false;
      try {
        showNative({
          title:
            notice.outcome === "completed"
              ? "Recording completed"
              : notice.outcome === "partial"
                ? "Partial recording saved"
                : "Recording failed",
          body:
            notice.outcome === "completed"
              ? `${notice.title} was saved.`
              : notice.outcome === "partial"
                ? `Some footage from ${notice.title} was saved.`
                : `No playable recording was saved for ${notice.title}.`,
          silent: !context.soundEnabled,
          onClick: () => {
            const current = sessionStore.getSnapshot().notice;
            if (promoted || current?.sessionId !== sessionId || current.delivery !== "native")
              return;
            promoted = true;
            focusWindow();
            sessionStore.setNotice({ ...current, delivery: "in-app" });
          },
        });
      } catch {
        const current = sessionStore.getSnapshot().notice;
        if (current?.sessionId === sessionId && current.delivery === "native") {
          sessionStore.setNotice({
            ...current,
            delivery: context.visible && !context.minimized ? "in-app" : "none",
          });
        }
      }
      return true;
    },
    async open(sessionId) {
      try {
        const owned = await ownedOutputPath(sessionId);
        if ("error" in owned) return { success: false, error: owned.error };
        const error = await recordingFileActions.openPath(owned.path);
        return error ? { success: false, error } : { success: true };
      } catch (error) {
        return actionError(error, "Could not open the recording");
      }
    },
    async show(sessionId) {
      try {
        const owned = await ownedOutputPath(sessionId);
        if ("error" in owned) return { success: false, error: owned.error };
        recordingFileActions.showItemInFolder(owned.path);
        return { success: true };
      } catch (error) {
        return actionError(error, "Could not show the recording in its folder");
      }
    },
    dismiss: (sessionId) => sessionStore.dismissNotice(sessionId),
  };
}
