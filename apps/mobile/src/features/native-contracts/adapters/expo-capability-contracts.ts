import {
  getCaptionsModule,
  getDiagnosticsModule,
  getMaintenanceModule,
  getMediaJobsModule,
  getPlaybackModule,
} from "../../../../modules/streamfusion-native-contracts/src/contracts";

import type {
  CaptionModelRequest,
  CaptionSessionRequest,
  PlaybackSessionRequest,
  VerifiedApk,
  VerifyDownloadedApkRequest,
} from "../capabilities/android-capability-contracts";

export interface ExpoBindingReader<TBinding> {
  read(): TBinding;
}

export interface ExpoPlaybackBinding {
  readonly addListener?: (
    eventName: string,
    listener: (event: unknown) => void,
  ) => { readonly remove: () => void };
  readonly endFocusedSession: (sessionId: string) => Promise<unknown>;
  readonly enterPictureInPicture: (sessionId: string) => Promise<unknown>;
  readonly getContractVersion: () => number;
  readonly listQualities: (sessionId: string) => Promise<unknown>;
  readonly seekTo: (
    sessionId: string,
    positionMs: number,
  ) => Promise<unknown>;
  readonly setMuted: (sessionId: string, muted: boolean) => Promise<unknown>;
  readonly setPlaying: (sessionId: string, playing: boolean) => Promise<unknown>;
  readonly setQuality: (sessionId: string, quality: string) => Promise<unknown>;
  readonly setVolume: (sessionId: string, volume: number) => Promise<unknown>;
  readonly startFocusedSession: (
    request: PlaybackSessionRequest,
  ) => Promise<unknown>;
}

export interface ExpoMediaJobsBinding {
  readonly cancelRecoverableJob: (jobId: string) => Promise<unknown>;
  readonly deleteRecoverableJob: (jobId: string) => Promise<unknown>;
  readonly exportRecoverableJob: (jobId: string) => Promise<unknown>;
  readonly finalizeRecoverableJob: (jobId: string) => Promise<unknown>;
  readonly getContractVersion: () => number;
  readonly getRecoverableJob: (jobId: string) => Promise<unknown>;
  readonly openRecoverableJob: (jobId: string) => Promise<unknown>;
  readonly pauseRecoverableJob: (jobId: string) => Promise<unknown>;
  readonly recoverJobs: () => Promise<unknown>;
  readonly resumeRecoverableJob: (jobId: string) => Promise<unknown>;
  readonly retryRecoverableJob: (jobId: string) => Promise<unknown>;
  readonly startRecoverableJob: (request: {
    readonly jobId: string;
    readonly kind: "download" | "recording";
    readonly requestHeaders?: Readonly<Record<string, string>>;
    readonly sourceUri: string;
  }) => Promise<unknown>;
}

export interface ExpoCaptionsBinding {
  readonly addListener?: (
    eventName: string,
    listener: (event: unknown) => void,
  ) => { readonly remove: () => void };
  readonly clearDevelopmentCaptionConstraint: () => Promise<unknown>;
  readonly getCaptionProof: () => Promise<unknown>;
  readonly getContractVersion: () => number;
  readonly getEnglishModelState: () => Promise<unknown>;
  readonly installEnglishModel: (request: CaptionModelRequest) => Promise<unknown>;
  readonly queueDevelopmentCaptionConstraint: () => Promise<unknown>;
  readonly removeEnglishModel: (request: CaptionModelRequest) => Promise<unknown>;
  readonly startFocusedCaptionSession: (
    request: CaptionSessionRequest,
  ) => Promise<unknown>;
  readonly stopFocusedCaptionSession: (sessionId: string) => Promise<unknown>;
}

export interface ExpoDiagnosticsBinding {
  readonly getContractVersion: () => number;
  readonly queueDevelopmentResourceSnapshotFailure: () => Promise<unknown>;
  readonly readResourceSnapshot: () => Promise<unknown>;
}

export interface ExpoMaintenanceBinding {
  readonly getContractVersion: () => number;
  readonly handoffVerifiedApk: (apk: VerifiedApk) => Promise<unknown>;
  readonly verifyDownloadedApk: (
    request: VerifyDownloadedApkRequest,
  ) => Promise<unknown>;
}

function requireBinding<TBinding>(
  module: TBinding | null,
  moduleName: string,
): TBinding {
  if (!module) {
    throw new Error(`${moduleName} is unavailable in this runtime.`);
  }
  return module;
}

export const expoPlaybackBindingReader: ExpoBindingReader<ExpoPlaybackBinding> = {
  read: () => requireBinding(getPlaybackModule(), "StreamFusionPlayback"),
};

export const expoMediaJobsBindingReader: ExpoBindingReader<ExpoMediaJobsBinding> = {
  read: () => requireBinding(getMediaJobsModule(), "StreamFusionMediaJobs"),
};

export const expoCaptionsBindingReader: ExpoBindingReader<ExpoCaptionsBinding> = {
  read: () => requireBinding(getCaptionsModule(), "StreamFusionCaptions"),
};

export const expoDiagnosticsBindingReader: ExpoBindingReader<ExpoDiagnosticsBinding> = {
  read: () => requireBinding(getDiagnosticsModule(), "StreamFusionDiagnostics"),
};

export const expoMaintenanceBindingReader: ExpoBindingReader<ExpoMaintenanceBinding> = {
  read: () => requireBinding(getMaintenanceModule(), "StreamFusionMaintenance"),
};
