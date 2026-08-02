import path from "node:path";

import { app, type BrowserWindow } from "electron";
import { IPC_CHANNELS } from "@/shared/ipc-channels";

import { LocalCaptionModelStore } from "./caption-model-store";
import { spawnCaptionUtilityProcess } from "./caption-utility-process";
import { LocalCaptionSupervisor } from "./local-caption-supervisor";

let targetWindow: BrowserWindow | null = null;
let modelStore: LocalCaptionModelStore | null = null;
let supervisor: LocalCaptionSupervisor | null = null;

function safeSend(channel: string, payload: unknown): void {
  try {
    if (targetWindow && !targetWindow.isDestroyed() && !targetWindow.webContents.isDestroyed()) {
      targetWindow.webContents.send(channel, payload);
    }
  } catch {
    // A closing renderer cannot own the recognizer lifecycle.
  }
}

export function getLocalCaptionRuntime(mainWindow: BrowserWindow) {
  targetWindow = mainWindow;
  modelStore ??= new LocalCaptionModelStore({
    modelsRoot: path.join(app.getPath("userData"), "models"),
  });
  supervisor ??= new LocalCaptionSupervisor({
    spawn: spawnCaptionUtilityProcess,
    maxInFlightChunks: 2,
    onResult: (result) => safeSend(IPC_CHANNELS.LOCAL_CAPTIONS_RESULT, result),
    onState: (state) => safeSend(IPC_CHANNELS.LOCAL_CAPTIONS_RECOGNIZER_STATE, state),
  });

  return { modelStore, supervisor };
}

export function disposeLocalCaptionRuntime(): void {
  supervisor?.dispose();
  targetWindow = null;
}
