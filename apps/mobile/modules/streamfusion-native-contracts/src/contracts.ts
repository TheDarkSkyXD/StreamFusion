import { requireNativeModule } from "expo";

export interface NativeUnsupportedResponse {
  readonly code: "NATIVE_OPERATION_UNSUPPORTED";
  readonly diagnostic: string;
  readonly kind: "unsupported";
}

interface NativePlaybackModule {
  endFocusedSession(sessionId: unknown): Promise<unknown>;
  enterPictureInPicture(sessionId: unknown): Promise<unknown>;
  getContractVersion(): number;
  startFocusedSession(request: unknown): Promise<unknown>;
}

interface NativeMediaJobsModule {
  cancelRecoverableJob(jobId: unknown): Promise<unknown>;
  finalizeRecoverableJob(jobId: unknown): Promise<unknown>;
  getContractVersion(): number;
  getRecoverableJob(jobId: unknown): Promise<unknown>;
  pauseRecoverableJob(jobId: unknown): Promise<unknown>;
  recoverJobs(): Promise<unknown>;
  resumeRecoverableJob(jobId: unknown): Promise<unknown>;
  retryRecoverableJob(jobId: unknown): Promise<unknown>;
  startRecoverableJob(request: unknown): Promise<unknown>;
}

interface NativeCaptionsModule {
  getContractVersion(): number;
  installEnglishModel(request: unknown): Promise<unknown>;
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

export function getPlaybackModule(): NativePlaybackModule {
  return requireNativeModule<NativePlaybackModule>("StreamFusionPlayback");
}

export function getMediaJobsModule(): NativeMediaJobsModule {
  return requireNativeModule<NativeMediaJobsModule>("StreamFusionMediaJobs");
}

export function getCaptionsModule(): NativeCaptionsModule {
  return requireNativeModule<NativeCaptionsModule>("StreamFusionCaptions");
}

export function getDiagnosticsModule(): NativeDiagnosticsModule {
  return requireNativeModule<NativeDiagnosticsModule>("StreamFusionDiagnostics");
}

export function getMaintenanceModule(): NativeMaintenanceModule {
  return requireNativeModule<NativeMaintenanceModule>("StreamFusionMaintenance");
}
