import { NativeEventEmitter, NativeModules } from "react-native";

export interface NativeUnsupportedResponse {
  readonly code: "NATIVE_OPERATION_UNSUPPORTED";
  readonly diagnostic: string;
  readonly kind: "unsupported";
}

interface NativePlaybackModule {
  addListener(event: "onNativePlayback", listener: (event: unknown) => void): { remove(): void };
  removeListeners(count: number): void;
  readPlaybackObservation(sessionId: unknown): Promise<unknown>;
  setPlaybackSpeed(sessionId: unknown, speed: unknown): Promise<unknown>;
  endFocusedSession(sessionId: unknown): Promise<unknown>;
  enterPictureInPicture(sessionId: unknown): Promise<unknown>;
  getContractVersion(): number;
  listQualities(sessionId: unknown): Promise<unknown>;
  seekTo(sessionId: unknown, positionMs: unknown): Promise<unknown>;
  setMuted(sessionId: unknown, muted: unknown): Promise<unknown>;
  setPlaying(sessionId: unknown, playing: unknown): Promise<unknown>;
  setQuality(sessionId: unknown, quality: unknown): Promise<unknown>;
  setVolume(sessionId: unknown, volume: unknown): Promise<unknown>;
  startFocusedSession(request: unknown): Promise<unknown>;
}

interface NativeMediaJobsModule {
  cancelRecoverableJob(jobId: unknown): Promise<unknown>;
  deleteRecoverableJob(jobId: unknown): Promise<unknown>;
  exportRecoverableJob(jobId: unknown): Promise<unknown>;
  finalizeRecoverableJob(jobId: unknown): Promise<unknown>;
  getContractVersion(): number;
  getRecoverableJob(jobId: unknown): Promise<unknown>;
  openRecoverableJob(jobId: unknown): Promise<unknown>;
  pauseRecoverableJob(jobId: unknown): Promise<unknown>;
  recoverJobs(): Promise<unknown>;
  resumeRecoverableJob(jobId: unknown): Promise<unknown>;
  retryRecoverableJob(jobId: unknown): Promise<unknown>;
  startRecoverableJob(request: unknown): Promise<unknown>;
}

interface NativeCaptionsModule {
  addListener(event: "onNativeCaptions" | "onNativeCaptionModel", listener: (event: unknown) => void): { remove(): void };
  removeListeners(count: number): void;
  cancelEnglishModelInstall(): unknown;
  getContractVersion(): number;
  clearDevelopmentCaptionConstraint(): Promise<unknown>;
  getCaptionProof(): Promise<unknown>;
  getEnglishModelState(): Promise<unknown>;
  installEnglishModel(request: unknown): Promise<unknown>;
  queueDevelopmentCaptionConstraint(): Promise<unknown>;
  removeEnglishModel(request: unknown): Promise<unknown>;
  startFocusedCaptionSession(request: unknown): Promise<unknown>;
  stopFocusedCaptionSession(sessionId: unknown): Promise<unknown>;
}

interface NativeDiagnosticsModule {
  getContractVersion(): number;
  queueDevelopmentResourceSnapshotFailure(): Promise<unknown>;
  readResourceSnapshot(): Promise<unknown>;
}

interface NativeMaintenanceModule {
  getContractVersion(): number;
  handoffVerifiedApk(apk: unknown): Promise<unknown>;
  verifyDownloadedApk(request: unknown): Promise<unknown>;
}

export interface NativeUpdaterModule {
  snapshot(): Promise<unknown>;
  command(command: unknown): Promise<unknown>;
  addListener(event: "onUpdateRevision", listener: (event: unknown) => void): { remove(): void };
  removeListeners(count: number): void;
}

export type NativeProxyRequestResult =
  | {
      readonly kind: "completed";
      readonly status: number;
      readonly headers: Record<string, string>;
      readonly body: string;
    }
  | NativeUnsupportedResponse;

interface NativeConnectivityModule {
  cancelProxyRequest(requestId: string): Promise<unknown>;
  getContractVersion(): number;
  proxyRequest(request: {
    readonly body: string | null;
    readonly headers: Record<string, string>;
    readonly host: string;
    readonly method: string;
    readonly password: string;
    readonly port: number;
    readonly requestId: string;
    readonly url: string;
    readonly username: string;
  }): Promise<NativeProxyRequestResult>;
}

export class NativeModuleUnavailableError extends Error {
  constructor(readonly moduleName: string) {
    super(`${moduleName} is unavailable in this runtime.`);
    this.name = "NativeModuleUnavailableError";
  }
}

function optionalNativeModule<T extends object>(
  moduleName: string,
  methods: readonly (keyof T)[],
): T | null {
  const native: unknown = NativeModules[moduleName];
  if (!native || typeof native !== "object") return null;
  if (!methods.every((method) => typeof Reflect.get(native, method) === "function")) {
    return null;
  }
  return native as T;
}

function withEvents<T extends object>(module: T, moduleName: string): T {
  const emitter = new NativeEventEmitter(NativeModules[moduleName]);
  return new Proxy(module, {
    get(target, property, receiver) {
      if (property === "addListener") {
        return (event: string, listener: (value: unknown) => void) =>
          emitter.addListener(event, listener);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

export function getPlaybackModule(): NativePlaybackModule | null {
  const module = optionalNativeModule<NativePlaybackModule>("StreamFusionPlayback", [
    "getContractVersion", "startFocusedSession", "endFocusedSession", "readPlaybackObservation",
    "setPlaybackSpeed", "setPlaying", "setMuted", "setVolume", "listQualities",
    "setQuality", "seekTo", "enterPictureInPicture", "addListener", "removeListeners",
  ]);
  return module ? withEvents(module, "StreamFusionPlayback") : null;
}

/** Returns null when the native module is absent. Never throws. */
export function getMediaJobsModule(): NativeMediaJobsModule | null {
  return optionalNativeModule<NativeMediaJobsModule>("StreamFusionMediaJobs", [
    "getContractVersion", "startRecoverableJob", "recoverJobs", "cancelRecoverableJob",
    "pauseRecoverableJob", "resumeRecoverableJob", "retryRecoverableJob",
    "finalizeRecoverableJob", "getRecoverableJob", "deleteRecoverableJob",
    "openRecoverableJob", "exportRecoverableJob",
  ]);
}

/** Returns null when the native module is absent. Never throws. */
export function getCaptionsModule(): NativeCaptionsModule | null {
  const module = optionalNativeModule<NativeCaptionsModule>("StreamFusionCaptions", [
    "getContractVersion", "cancelEnglishModelInstall", "getEnglishModelState",
    "installEnglishModel", "removeEnglishModel", "startFocusedCaptionSession",
    "stopFocusedCaptionSession", "getCaptionProof", "queueDevelopmentCaptionConstraint",
    "clearDevelopmentCaptionConstraint", "addListener", "removeListeners",
  ]);
  return module ? withEvents(module, "StreamFusionCaptions") : null;
}

/** Returns null when the native module is absent. Never throws. */
export function getDiagnosticsModule(): NativeDiagnosticsModule | null {
  return optionalNativeModule<NativeDiagnosticsModule>("StreamFusionDiagnostics", [
    "getContractVersion", "queueDevelopmentResourceSnapshotFailure", "readResourceSnapshot",
  ]);
}

/** Returns null when the native module is absent. Never throws. */
export function getMaintenanceModule(): NativeMaintenanceModule | null {
  return optionalNativeModule<NativeMaintenanceModule>("StreamFusionMaintenance", [
    "getContractVersion", "verifyDownloadedApk", "handoffVerifiedApk",
  ]);
}

export function getUpdaterModule(): NativeUpdaterModule | null {
  const module = optionalNativeModule<NativeUpdaterModule>("StreamFusionUpdater", [
    "snapshot", "command", "addListener", "removeListeners",
  ]);
  return module ? withEvents(module, "StreamFusionUpdater") : null;
}

/** Returns null when the native module is absent. Never throws. */
export function getConnectivityModule(): NativeConnectivityModule | null {
  return optionalNativeModule<NativeConnectivityModule>("StreamFusionConnectivity", [
    "getContractVersion", "proxyRequest", "cancelProxyRequest",
  ]);
}

export function requirePlaybackModule(): NativePlaybackModule {
  const module = getPlaybackModule();
  if (!module) throw new NativeModuleUnavailableError("StreamFusionPlayback");
  return module;
}

export function requireMediaJobsModule(): NativeMediaJobsModule {
  const module = getMediaJobsModule();
  if (!module) throw new NativeModuleUnavailableError("StreamFusionMediaJobs");
  return module;
}

export function requireCaptionsModule(): NativeCaptionsModule {
  const module = getCaptionsModule();
  if (!module) throw new NativeModuleUnavailableError("StreamFusionCaptions");
  return module;
}

export function requireDiagnosticsModule(): NativeDiagnosticsModule {
  const module = getDiagnosticsModule();
  if (!module) throw new NativeModuleUnavailableError("StreamFusionDiagnostics");
  return module;
}

export function requireMaintenanceModule(): NativeMaintenanceModule {
  const module = getMaintenanceModule();
  if (!module) throw new NativeModuleUnavailableError("StreamFusionMaintenance");
  return module;
}

export function requireConnectivityModule(): NativeConnectivityModule {
  const module = getConnectivityModule();
  if (!module) throw new NativeModuleUnavailableError("StreamFusionConnectivity");
  return module;
}
