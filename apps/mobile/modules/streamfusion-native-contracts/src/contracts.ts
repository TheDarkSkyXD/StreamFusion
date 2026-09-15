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

export function getConnectivityModule(): NativeConnectivityModule {
  return requireNativeModule<NativeConnectivityModule>(
    "StreamFusionConnectivity",
  );
}
