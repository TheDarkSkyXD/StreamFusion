import path from "node:path";

import { app } from "electron";
import { IPC_CHANNELS } from "@shared/ipc-channels";

import { LocalCaptionModelStore } from "../data/caption-model-store";
import { spawnCaptionUtilityProcess } from "../adapters/electron/caption-utility-process";
import { LocalCaptionSupervisor } from "../domain/local-caption-supervisor";
import type { MainRendererPort } from "@backend/ipc/main-renderer-port";

let modelStore: LocalCaptionModelStore | null = null;
let supervisor: LocalCaptionSupervisor | null = null;

export function getLocalCaptionRuntime(renderer: MainRendererPort) {
  modelStore ??= new LocalCaptionModelStore({
    modelsRoot: path.join(app.getPath("userData"), "models"),
  });
  supervisor ??= new LocalCaptionSupervisor({
    spawn: spawnCaptionUtilityProcess,
    maxInFlightChunks: 2,
    onResult: (result) => renderer.send(IPC_CHANNELS.LOCAL_CAPTIONS_RESULT, result),
    onState: (state) => renderer.send(IPC_CHANNELS.LOCAL_CAPTIONS_RECOGNIZER_STATE, state),
  });

  return { modelStore, supervisor };
}

export function disposeLocalCaptionRuntime(): void {
  supervisor?.dispose();
  supervisor = null;
}
