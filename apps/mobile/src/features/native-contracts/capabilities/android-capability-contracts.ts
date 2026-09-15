import type {
  MediaJobFileEvidence,
  MediaJobNativeJournal,
} from "@streamfusion/core/media-jobs";

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
      readonly contractVersion: 1 | 2 | 3;
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
  readonly filtering?: {
    readonly enabled: boolean;
    readonly mode: "passthrough" | "canary" | "strip";
    readonly platform: string;
  };
  readonly requestHeaders: Readonly<Record<string, string>>;
  readonly sessionId: string;
  readonly sourceUri: string;
}

export interface PlaybackSessionState {
  readonly pictureInPictureEligible: boolean;
  readonly sessionId: string;
}

export type PlaybackEndState =
  | {
      readonly kind: "ended";
      readonly state: PlaybackSessionState;
    }
  | {
      readonly kind: "missing";
      readonly sessionId: string;
    };

export type NativePlaybackFailureCode =
  | "PLAYBACK_DECODER_UNSUPPORTED"
  | "PLAYBACK_NETWORK_FAILED"
  | "PLAYBACK_SOURCE_REJECTED"
  | "PLAYBACK_UNKNOWN";

export type NativePlaybackEvent =
  | { readonly kind: "buffering"; readonly sessionId: string }
  | { readonly kind: "playing"; readonly sessionId: string }
  | {
      readonly kind: "paused";
      readonly reason: "background" | "user";
      readonly sessionId: string;
    }
  | { readonly kind: "ended"; readonly sessionId: string }
  | {
      readonly durationMs: number;
      readonly kind: "progress";
      readonly positionMs: number;
      readonly seekable: boolean;
      readonly sessionId: string;
    }
  | {
      readonly kind: "picture-in-picture-exited";
      readonly sessionId: string;
    }
  | {
      readonly diagnostic: string;
      readonly kind: "filtering";
      readonly sessionId: string;
    }
  | {
      readonly code: NativePlaybackFailureCode;
      readonly detail: string;
      readonly kind: "failed";
      readonly sessionId: string;
    };

export type PlaybackQualityCatalog = {
  readonly qualities: readonly string[];
  readonly selected: string;
  readonly sessionId: string;
};

export interface AndroidPlaybackContractPort extends AndroidCapabilityContractPort {
  endFocusedSession(
    sessionId: string,
  ): Promise<AndroidNativeOperationResult<PlaybackEndState>>;
  enterPictureInPicture(
    sessionId: string,
  ): Promise<AndroidNativeOperationResult<PlaybackSessionState>>;
  listQualities(
    sessionId: string,
  ): Promise<AndroidNativeOperationResult<PlaybackQualityCatalog>>;
  setMuted(
    sessionId: string,
    muted: boolean,
  ): Promise<AndroidNativeOperationResult<PlaybackSessionState>>;
  seekTo(
    sessionId: string,
    positionMs: number,
  ): Promise<AndroidNativeOperationResult<PlaybackSessionState>>;
  setPlaying(
    sessionId: string,
    playing: boolean,
  ): Promise<AndroidNativeOperationResult<PlaybackSessionState>>;
  setQuality(
    sessionId: string,
    quality: string,
  ): Promise<AndroidNativeOperationResult<PlaybackQualityCatalog>>;
  setVolume(
    sessionId: string,
    volume: number,
  ): Promise<AndroidNativeOperationResult<PlaybackSessionState>>;
  startFocusedSession(
    request: PlaybackSessionRequest,
  ): Promise<AndroidNativeOperationResult<PlaybackSessionState>>;
  subscribe(listener: (event: NativePlaybackEvent) => void): () => void;
}

export type MediaJobKind = "download" | "recording";

export interface MediaJobStartRequest {
  readonly jobId: string;
  readonly kind: MediaJobKind;
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly sourceUri: string;
}

export type MediaJobExportNativeResult =
  | {
      readonly destinationSha256: string;
      readonly destinationUri: string;
      readonly jobId: string;
      readonly kind: "exported";
      readonly matched: boolean;
      readonly sourceSha256: string;
    }
  | { readonly kind: "cancelled" }
  | { readonly jobId: string; readonly kind: "unavailable" }
  | { readonly jobId: string; readonly kind: "missing" };

export type MediaJobDeleteNativeResult =
  | { readonly jobId: string; readonly kind: "deleted" }
  | { readonly jobId: string; readonly kind: "missing" };

export type MediaJobOpenNativeResult =
  | { readonly jobId: string; readonly kind: "opened" }
  | { readonly jobId: string; readonly kind: "unavailable" }
  | { readonly jobId: string; readonly kind: "missing" };

export type MediaJobNativeResult =
  | {
      readonly files: MediaJobFileEvidence | null;
      readonly journal: MediaJobNativeJournal;
      readonly kind: "record";
    }
  | { readonly jobId: string; readonly kind: "missing" };

export interface AndroidMediaJobsContractPort extends AndroidCapabilityContractPort {
  cancelRecoverableJob(
    jobId: string,
  ): Promise<AndroidNativeOperationResult<MediaJobNativeResult>>;
  finalizeRecoverableJob(
    jobId: string,
  ): Promise<AndroidNativeOperationResult<MediaJobNativeResult>>;
  getRecoverableJob(
    jobId: string,
  ): Promise<AndroidNativeOperationResult<MediaJobNativeResult>>;
  pauseRecoverableJob(
    jobId: string,
  ): Promise<AndroidNativeOperationResult<MediaJobNativeResult>>;
  recoverJobs(): Promise<
    AndroidNativeOperationResult<readonly MediaJobNativeResult[]>
  >;
  resumeRecoverableJob(
    jobId: string,
  ): Promise<AndroidNativeOperationResult<MediaJobNativeResult>>;
  retryRecoverableJob(
    jobId: string,
  ): Promise<AndroidNativeOperationResult<MediaJobNativeResult>>;
  startRecoverableJob(
    request: MediaJobStartRequest,
  ): Promise<AndroidNativeOperationResult<MediaJobNativeResult>>;
  deleteRecoverableJob(
    jobId: string,
  ): Promise<AndroidNativeOperationResult<MediaJobDeleteNativeResult>>;
  exportRecoverableJob(
    jobId: string,
  ): Promise<AndroidNativeOperationResult<MediaJobExportNativeResult>>;
  openRecoverableJob(
    jobId: string,
  ): Promise<AndroidNativeOperationResult<MediaJobOpenNativeResult>>;
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

export type AndroidExecutionEnvironment = "emulator" | "physical" | "unknown";

export type AndroidThermalState =
  | "none"
  | "light"
  | "moderate"
  | "severe"
  | "critical"
  | "emergency"
  | "shutdown";

export interface AndroidDecoderObservation {
  readonly hardwareAccelerated: boolean;
  readonly mimeTypes: readonly string[];
  readonly name: string;
  readonly softwareOnly: boolean;
}

export interface AndroidRuntimeIdentity {
  readonly apiLevel: number;
  readonly applicationId: string;
  readonly formFactor: AndroidFormFactorObservation;
  readonly executionEnvironment: AndroidExecutionEnvironment;
  readonly supportedAbis: readonly string[];
  readonly versionCode: number;
}

export interface AndroidFormFactorObservation {
  readonly automotive: boolean;
  readonly pc: boolean;
  readonly touchscreen: boolean;
  readonly television: boolean;
  readonly uiModeType: number;
  readonly watch: boolean;
}

export interface AndroidMemoryObservation {
  readonly availableBytes: number;
  readonly lowMemory: boolean;
  readonly runtimeFreeBytes: number;
  readonly runtimeMaxBytes: number;
  readonly runtimeTotalBytes: number;
  readonly thresholdBytes: number;
  readonly totalBytes: number;
}

export interface AndroidStorageObservation {
  readonly availableBytes: number;
  readonly totalBytes: number;
}

export type AndroidThermalObservation =
  | { readonly kind: "observed"; readonly state: AndroidThermalState }
  | { readonly detail: string; readonly kind: "unavailable" };

export interface AndroidResourceSnapshot {
  readonly decoders: readonly AndroidDecoderObservation[];
  readonly memory: AndroidMemoryObservation;
  readonly observedAtEpochMs: number;
  readonly runtime: AndroidRuntimeIdentity;
  readonly storage: AndroidStorageObservation;
  readonly thermal: AndroidThermalObservation;
}

export interface AndroidDevelopmentResourceSnapshotFailureQueue {
  readonly queued: true;
}

export interface AndroidDiagnosticsContractPort extends AndroidCapabilityContractPort {
  queueDevelopmentResourceSnapshotFailure(): Promise<
    AndroidNativeOperationResult<AndroidDevelopmentResourceSnapshotFailureQueue>
  >;
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
