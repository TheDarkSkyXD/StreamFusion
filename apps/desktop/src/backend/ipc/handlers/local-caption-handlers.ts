import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";

import { isAllowedSender, type SenderFrameLike } from "@backend/ipc/sender-origin";
import type { LocalCaptionLease } from "@backend/services/captions/local-caption-supervisor";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type {
  LocalCaptionModelState,
  LocalCaptionPcmChunk,
  LocalCaptionSessionIdentity,
} from "@shared/local-caption-types";
import type { MainRendererPort } from "../main-renderer-port";
import { registerLoadedFeatureCleanup } from "../../startup/loaded-feature-cleanup";

interface LocalCaptionModelStoreBridge {
  getState(): Promise<LocalCaptionModelState>;
  install(): Promise<string>;
  cancel(): void;
  remove(): Promise<void>;
  getActiveModelPath(): Promise<string | null>;
  subscribe(listener: (state: LocalCaptionModelState) => void): () => void;
}

interface LocalCaptionSupervisorBridge {
  start(lease: LocalCaptionLease): void;
  stop(identity: LocalCaptionSessionIdentity): boolean;
  pushAudio(chunk: LocalCaptionPcmChunk): boolean;
}

export interface LocalCaptionHandlerDependencies {
  modelStore: LocalCaptionModelStoreBridge;
  supervisor: LocalCaptionSupervisorBridge;
}

const REJECTED = {
  success: false as const,
  error: "Rejected: caller is not the application renderer.",
};

function isSessionIdentity(payload: unknown): payload is LocalCaptionSessionIdentity {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as { sessionId?: unknown; generation?: unknown };
  return (
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0 &&
    Number.isSafeInteger(candidate.generation) &&
    Number(candidate.generation) > 0
  );
}

export function registerLocalCaptionHandlers(
  renderer: MainRendererPort,
  dependencies: LocalCaptionHandlerDependencies
): void {
  const unsubscribe = dependencies.modelStore.subscribe((state) => {
    renderer.send(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_STATE, state);
  });
  registerLoadedFeatureCleanup("local-captions:model-events", unsubscribe);

  ipcMain.handle(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_GET_STATE, (event: SenderFrameLike) => {
    if (!isAllowedSender(event)) return REJECTED;
    return dependencies.modelStore.getState();
  });

  ipcMain.handle(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_DOWNLOAD, async (event: SenderFrameLike) => {
    if (!isAllowedSender(event)) return REJECTED;
    try {
      await dependencies.modelStore.install();
      return { success: true as const, state: await dependencies.modelStore.getState() };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Model download failed",
        state: await dependencies.modelStore.getState(),
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_CANCEL, (event: SenderFrameLike) => {
    if (!isAllowedSender(event)) return REJECTED;
    dependencies.modelStore.cancel();
    return { success: true as const };
  });

  ipcMain.handle(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_REMOVE, async (event: SenderFrameLike) => {
    if (!isAllowedSender(event)) return REJECTED;
    await dependencies.modelStore.remove();
    return { success: true as const, state: await dependencies.modelStore.getState() };
  });

  ipcMain.handle(
    IPC_CHANNELS.LOCAL_CAPTIONS_SESSION_START,
    async (event: SenderFrameLike, payload: unknown) => {
      if (!isAllowedSender(event)) return REJECTED;
      if (!isSessionIdentity(payload))
        return { success: false as const, error: "Invalid session." };
      const modelPath = await dependencies.modelStore.getActiveModelPath();
      if (!modelPath) {
        return {
          success: false as const,
          error: "Download and verify the English model first.",
        };
      }
      dependencies.supervisor.start({ ...payload, modelPath });
      return { success: true as const };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.LOCAL_CAPTIONS_AUDIO_PUSH,
    (event: SenderFrameLike, payload: LocalCaptionPcmChunk) => {
      if (!isAllowedSender(event)) return { accepted: false };
      return { accepted: dependencies.supervisor.pushAudio(payload) };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.LOCAL_CAPTIONS_SESSION_STOP,
    (event: SenderFrameLike, payload: unknown) => {
      if (!isAllowedSender(event)) return REJECTED;
      if (!isSessionIdentity(payload))
        return { success: false as const, error: "Invalid session." };
      dependencies.supervisor.stop(payload);
      return { success: true as const };
    }
  );
}
