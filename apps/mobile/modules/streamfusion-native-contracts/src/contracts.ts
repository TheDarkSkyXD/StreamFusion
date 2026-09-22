import { requireOptionalNativeModule } from "expo";

export interface NativeUnsupportedResponse {
  readonly code: "NATIVE_OPERATION_UNSUPPORTED";
  readonly diagnostic: string;
  readonly kind: "unsupported";
}

interface NativePlaybackModule {
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

function optionalNativeModule<T>(moduleName: string): T | null {
  try {
    return requireOptionalNativeModule<T>(moduleName);
  } catch {
    return null;
  }
}

function requireLinkedNativeModule<T>(moduleName: string): T {
  const module = optionalNativeModule<T>(moduleName);
  if (!module) throw new NativeModuleUnavailableError(moduleName);
  return module;
}

/** Returns null in Expo Go and other hosts without the native module. Never throws. */
export function getPlaybackModule(): NativePlaybackModule | null {
  return optionalNativeModule<NativePlaybackModule>("StreamFusionPlayback");
}

/** Returns null when the native module is absent. Never throws. */
export function getMediaJobsModule(): NativeMediaJobsModule | null {
  return optionalNativeModule<NativeMediaJobsModule>("StreamFusionMediaJobs");
}

/** Returns null when the native module is absent. Never throws. */
export function getCaptionsModule(): NativeCaptionsModule | null {
  return optionalNativeModule<NativeCaptionsModule>("StreamFusionCaptions");
}

/** Returns null when the native module is absent. Never throws. */
export function getDiagnosticsModule(): NativeDiagnosticsModule | null {
  return optionalNativeModule<NativeDiagnosticsModule>(
    "StreamFusionDiagnostics",
  );
}

/** Returns null when the native module is absent. Never throws. */
export function getMaintenanceModule(): NativeMaintenanceModule | null {
  return optionalNativeModule<NativeMaintenanceModule>(
    "StreamFusionMaintenance",
  );
}

/** Returns null when the native module is absent. Never throws. */
export function getConnectivityModule(): NativeConnectivityModule | null {
  return optionalNativeModule<NativeConnectivityModule>(
    "StreamFusionConnectivity",
  );
}

export function requirePlaybackModule(): NativePlaybackModule {
  return requireLinkedNativeModule<NativePlaybackModule>("StreamFusionPlayback");
}

export function requireMediaJobsModule(): NativeMediaJobsModule {
  return requireLinkedNativeModule<NativeMediaJobsModule>(
    "StreamFusionMediaJobs",
  );
}

export function requireCaptionsModule(): NativeCaptionsModule {
  return requireLinkedNativeModule<NativeCaptionsModule>("StreamFusionCaptions");
}

export function requireDiagnosticsModule(): NativeDiagnosticsModule {
  return requireLinkedNativeModule<NativeDiagnosticsModule>(
    "StreamFusionDiagnostics",
  );
}

export function requireMaintenanceModule(): NativeMaintenanceModule {
  return requireLinkedNativeModule<NativeMaintenanceModule>(
    "StreamFusionMaintenance",
  );
}

export function requireConnectivityModule(): NativeConnectivityModule {
  return requireLinkedNativeModule<NativeConnectivityModule>(
    "StreamFusionConnectivity",
  );
}
