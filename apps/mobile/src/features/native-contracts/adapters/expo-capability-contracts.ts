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
  readonly endFocusedSession: (sessionId: string) => Promise<unknown>;
  readonly enterPictureInPicture: (sessionId: string) => Promise<unknown>;
  readonly getContractVersion: () => number;
  readonly startFocusedSession: (
    request: PlaybackSessionRequest,
  ) => Promise<unknown>;
}

export interface ExpoMediaJobsBinding {
  readonly cancelRecoverableJob: (jobId: string) => Promise<unknown>;
  readonly getContractVersion: () => number;
  readonly recoverJobs: () => Promise<unknown>;
  readonly startRecoverableJob: (request: {
    readonly jobId: string;
    readonly kind: "download" | "recording";
    readonly sourceUri: string;
  }) => Promise<unknown>;
}

export interface ExpoCaptionsBinding {
  readonly getContractVersion: () => number;
  readonly installEnglishModel: (request: CaptionModelRequest) => Promise<unknown>;
  readonly removeEnglishModel: (request: CaptionModelRequest) => Promise<unknown>;
  readonly startFocusedCaptionSession: (
    request: CaptionSessionRequest,
  ) => Promise<unknown>;
  readonly stopFocusedCaptionSession: (sessionId: string) => Promise<unknown>;
}

export interface ExpoDiagnosticsBinding {
  readonly getContractVersion: () => number;
  readonly readResourceSnapshot: () => Promise<unknown>;
}

export interface ExpoMaintenanceBinding {
  readonly getContractVersion: () => number;
  readonly handoffVerifiedApk: (apk: VerifiedApk) => Promise<unknown>;
  readonly verifyDownloadedApk: (
    request: VerifyDownloadedApkRequest,
  ) => Promise<unknown>;
}

export const expoPlaybackBindingReader: ExpoBindingReader<ExpoPlaybackBinding> = {
  read: getPlaybackModule,
};

export const expoMediaJobsBindingReader: ExpoBindingReader<ExpoMediaJobsBinding> = {
  read: getMediaJobsModule,
};

export const expoCaptionsBindingReader: ExpoBindingReader<ExpoCaptionsBinding> = {
  read: getCaptionsModule,
};

export const expoDiagnosticsBindingReader: ExpoBindingReader<ExpoDiagnosticsBinding> = {
  read: getDiagnosticsModule,
};

export const expoMaintenanceBindingReader: ExpoBindingReader<ExpoMaintenanceBinding> = {
  read: getMaintenanceModule,
};
