export const ANDROID_CAPABILITY_IDS = [
  "playback",
  "media-jobs",
  "captions",
  "diagnostics",
  "maintenance",
] as const;

export type AndroidCapabilityId = (typeof ANDROID_CAPABILITY_IDS)[number];

export type AndroidNativeFailure =
  | { readonly code: "NATIVE_BINDING_UNAVAILABLE"; readonly diagnostic: string }
  | {
      readonly code: "NATIVE_CONTRACT_VERSION_UNSUPPORTED";
      readonly diagnostic: string;
    }
  | { readonly code: "NATIVE_INVOCATION_FAILED"; readonly diagnostic: string }
  | { readonly code: "NATIVE_RESULT_INVALID"; readonly diagnostic: string }
  | {
      readonly code: "NATIVE_OPERATION_UNSUPPORTED";
      readonly diagnostic: string;
    };

export type AndroidCapabilityReadiness =
  | {
      readonly capability: AndroidCapabilityId;
      readonly contractVersion: 1;
      readonly kind: "ready";
    }
  | {
      readonly capability: AndroidCapabilityId;
      readonly failure: Exclude<
        AndroidNativeFailure,
        { readonly code: "NATIVE_OPERATION_UNSUPPORTED" }
      >;
      readonly kind: "unavailable";
    };

export type AndroidNativeOperationResult<TValue> =
  | { readonly kind: "completed"; readonly value: TValue }
  | { readonly failure: AndroidNativeFailure; readonly kind: "unavailable" }
  | {
      readonly failure: Extract<
        AndroidNativeFailure,
        { readonly code: "NATIVE_OPERATION_UNSUPPORTED" }
      >;
      readonly kind: "unsupported";
    };

export interface AndroidCapabilityContractPort {
  readiness(): AndroidCapabilityReadiness;
}

export interface PlaybackSessionRequest {
  readonly sessionId: string;
  readonly sourceUri: string;
}

export interface PlaybackSessionState {
  readonly pictureInPictureEligible: boolean;
  readonly sessionId: string;
}

export interface AndroidPlaybackContractPort extends AndroidCapabilityContractPort {
  endFocusedSession(
    sessionId: string,
  ): Promise<AndroidNativeOperationResult<PlaybackSessionState>>;
  enterPictureInPicture(
    sessionId: string,
  ): Promise<AndroidNativeOperationResult<PlaybackSessionState>>;
  startFocusedSession(
    request: PlaybackSessionRequest,
  ): Promise<AndroidNativeOperationResult<PlaybackSessionState>>;
}

export type MediaJobKind = "download" | "recording";

export interface MediaJobStartRequest {
  readonly jobId: string;
  readonly kind: MediaJobKind;
  readonly sourceUri: string;
}

export interface MediaJobState {
  readonly jobId: string;
  readonly kind: MediaJobKind;
  readonly phase: "queued" | "running" | "paused" | "completed" | "cancelled";
}

export interface AndroidMediaJobsContractPort extends AndroidCapabilityContractPort {
  cancelRecoverableJob(
    jobId: string,
  ): Promise<AndroidNativeOperationResult<MediaJobState>>;
  recoverJobs(): Promise<AndroidNativeOperationResult<readonly MediaJobState[]>>;
  startRecoverableJob(
    request: MediaJobStartRequest,
  ): Promise<AndroidNativeOperationResult<MediaJobState>>;
}

export interface CaptionModelRequest {
  readonly modelId: "english-v1";
}

export interface CaptionModelState {
  readonly installed: boolean;
  readonly modelId: "english-v1";
}

export interface CaptionSessionRequest {
  readonly modelId: "english-v1";
  readonly sessionId: string;
}

export interface CaptionSessionState {
  readonly sessionId: string;
  readonly state: "active" | "stopped";
}

export interface AndroidCaptionsContractPort extends AndroidCapabilityContractPort {
  installEnglishModel(
    request: CaptionModelRequest,
  ): Promise<AndroidNativeOperationResult<CaptionModelState>>;
  removeEnglishModel(
    request: CaptionModelRequest,
  ): Promise<AndroidNativeOperationResult<CaptionModelState>>;
  startFocusedCaptionSession(
    request: CaptionSessionRequest,
  ): Promise<AndroidNativeOperationResult<CaptionSessionState>>;
  stopFocusedCaptionSession(
    sessionId: string,
  ): Promise<AndroidNativeOperationResult<CaptionSessionState>>;
}

export interface AndroidResourceSnapshot {
  readonly availableStorageBytes: number;
  readonly observedAtEpochMs: number;
  readonly thermalState: "nominal" | "light" | "moderate" | "severe" | "critical";
}

export interface AndroidDiagnosticsContractPort extends AndroidCapabilityContractPort {
  readResourceSnapshot(): Promise<AndroidNativeOperationResult<AndroidResourceSnapshot>>;
}

export interface VerifyDownloadedApkRequest {
  readonly artifactUri: string;
  readonly expectedApplicationId: string;
  readonly expectedSha256: string;
  readonly expectedSignerSha256: string;
  readonly minimumVersionCode: number;
}

export interface VerifiedApk {
  readonly applicationId: string;
  readonly artifactUri: string;
  readonly signerSha256: string;
  readonly sha256: string;
  readonly versionCode: number;
}

export interface PackageInstallHandoff {
  readonly artifactUri: string;
  readonly state: "requested" | "awaiting-user-action";
}

export interface AndroidMaintenanceContractPort extends AndroidCapabilityContractPort {
  handoffVerifiedApk(
    apk: VerifiedApk,
  ): Promise<AndroidNativeOperationResult<PackageInstallHandoff>>;
  verifyDownloadedApk(
    request: VerifyDownloadedApkRequest,
  ): Promise<AndroidNativeOperationResult<VerifiedApk>>;
}

export interface AndroidCapabilityContracts {
  readonly captions: AndroidCaptionsContractPort;
  readonly diagnostics: AndroidDiagnosticsContractPort;
  readonly maintenance: AndroidMaintenanceContractPort;
  readonly mediaJobs: AndroidMediaJobsContractPort;
  readonly playback: AndroidPlaybackContractPort;
}
