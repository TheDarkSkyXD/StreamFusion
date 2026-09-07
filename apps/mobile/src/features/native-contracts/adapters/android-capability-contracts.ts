import type {
  AndroidCaptionsContractPort,
  AndroidCapabilityId,
  AndroidCapabilityReadiness,
  AndroidDiagnosticsContractPort,
  AndroidMaintenanceContractPort,
  AndroidMediaJobsContractPort,
  AndroidNativeFailure,
  AndroidNativeOperationResult,
  AndroidPlaybackContractPort,
  AndroidResourceSnapshot,
  CaptionModelState,
  CaptionSessionState,
  MediaJobState,
  PackageInstallHandoff,
  PlaybackSessionState,
  VerifiedApk,
} from "../capabilities/android-capability-contracts";
import type {
  ExpoBindingReader,
  ExpoCaptionsBinding,
  ExpoDiagnosticsBinding,
  ExpoMaintenanceBinding,
  ExpoMediaJobsBinding,
  ExpoPlaybackBinding,
} from "./expo-capability-contracts";

type BindingResolution<TBinding> =
  | { readonly binding: TBinding; readonly kind: "available" }
  | {
      readonly failure: Exclude<
        AndroidNativeFailure,
        { readonly code: "NATIVE_OPERATION_UNSUPPORTED" }
      >;
      readonly kind: "unavailable";
    };

function describe(capability: AndroidCapabilityId): string {
  return capability.replaceAll("-", " ");
}

function resolveBinding<TBinding extends { readonly getContractVersion: () => number }>(
  capability: AndroidCapabilityId,
  reader: ExpoBindingReader<TBinding>,
): BindingResolution<TBinding> {
  let binding: TBinding;
  try {
    binding = reader.read();
  } catch {
    return {
      kind: "unavailable",
      failure: {
        code: "NATIVE_BINDING_UNAVAILABLE",
        diagnostic: `Rebuild StreamFusion Development to include the ${describe(capability)} Android module, then retry.`,
      },
    };
  }

  let version: number;
  try {
    version = binding.getContractVersion();
  } catch {
    return {
      kind: "unavailable",
      failure: {
        code: "NATIVE_INVOCATION_FAILED",
        diagnostic: `The ${describe(capability)} Android module did not report its contract version. Reopen StreamFusion and retry.`,
      },
    };
  }

  if (!Number.isInteger(version)) {
    return {
      kind: "unavailable",
      failure: {
        code: "NATIVE_RESULT_INVALID",
        diagnostic: `Rebuild StreamFusion Development because the ${describe(capability)} Android module returned an invalid contract version.`,
      },
    };
  }
  if (version !== 1) {
    return {
      kind: "unavailable",
      failure: {
        code: "NATIVE_CONTRACT_VERSION_UNSUPPORTED",
        diagnostic: `Rebuild StreamFusion Development because the ${describe(capability)} Android module uses contract version ${version}.`,
      },
    };
  }
  return { binding, kind: "available" };
}

function readiness<TBinding extends { readonly getContractVersion: () => number }>(
  capability: AndroidCapabilityId,
  reader: ExpoBindingReader<TBinding>,
): AndroidCapabilityReadiness {
  const resolution = resolveBinding(capability, reader);
  return resolution.kind === "available"
    ? { capability, contractVersion: 1, kind: "ready" }
    : { capability, kind: "unavailable", failure: resolution.failure };
}

function object(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value));
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sha256(value: unknown): string | undefined {
  const digest = nonEmptyString(value);
  return digest && /^[a-f0-9]{64}$/iu.test(digest) ? digest : undefined;
}

function unsupported(value: unknown): string | undefined {
  const response = object(value);
  return response && response.kind === "unsupported" &&
    response.code === "NATIVE_OPERATION_UNSUPPORTED" &&
    typeof response.diagnostic === "string" && response.diagnostic.length > 0
    ? response.diagnostic
    : undefined;
}

function completed<TValue>(
  value: unknown,
  parse: (candidate: unknown) => TValue | undefined,
): TValue | undefined {
  const response = object(value);
  return response && response.kind === "completed" ? parse(response.value) : undefined;
}

async function invoke<TBinding extends { readonly getContractVersion: () => number }, TValue>(
  capability: AndroidCapabilityId,
  reader: ExpoBindingReader<TBinding>,
  operation: (binding: TBinding) => Promise<unknown>,
  parse: (candidate: unknown) => TValue | undefined,
): Promise<AndroidNativeOperationResult<TValue>> {
  const resolution = resolveBinding(capability, reader);
  if (resolution.kind === "unavailable") {
    return { kind: "unavailable", failure: resolution.failure };
  }
  let response: unknown;
  try {
    response = await operation(resolution.binding);
  } catch {
    return {
      kind: "unavailable",
      failure: {
        code: "NATIVE_INVOCATION_FAILED",
        diagnostic: `${describe(capability)} Android work did not complete. Retry this capability after reopening StreamFusion.`,
      },
    };
  }
  const diagnostic = unsupported(response);
  if (diagnostic) {
    return {
      kind: "unsupported",
      failure: { code: "NATIVE_OPERATION_UNSUPPORTED", diagnostic },
    };
  }
  const result = completed(response, parse);
  if (result !== undefined) return { kind: "completed", value: result };
  return {
    kind: "unavailable",
    failure: {
      code: "NATIVE_RESULT_INVALID",
      diagnostic: `Rebuild StreamFusion Development because the ${describe(capability)} Android module returned an invalid operation result.`,
    },
  };
}

function playbackState(value: unknown): PlaybackSessionState | undefined {
  const state = object(value);
  const sessionId = state ? nonEmptyString(state.sessionId) : undefined;
  return state && sessionId && typeof state.pictureInPictureEligible === "boolean"
    ? { sessionId, pictureInPictureEligible: state.pictureInPictureEligible }
    : undefined;
}

function mediaJobState(value: unknown): MediaJobState | undefined {
  const state = object(value);
  const jobId = state ? nonEmptyString(state.jobId) : undefined;
  const phase = state?.phase;
  return state && jobId && (state.kind === "download" || state.kind === "recording") &&
    (phase === "queued" || phase === "running" || phase === "paused" || phase === "completed" || phase === "cancelled")
    ? { jobId, kind: state.kind, phase }
    : undefined;
}

function captionModelState(value: unknown): CaptionModelState | undefined {
  const state = object(value);
  return state && state.modelId === "english-v1" && typeof state.installed === "boolean"
    ? { modelId: state.modelId, installed: state.installed }
    : undefined;
}

function captionSessionState(value: unknown): CaptionSessionState | undefined {
  const state = object(value);
  const sessionId = state ? nonEmptyString(state.sessionId) : undefined;
  return state && sessionId && (state.state === "active" || state.state === "stopped")
    ? { sessionId, state: state.state }
    : undefined;
}

function resourceSnapshot(value: unknown): AndroidResourceSnapshot | undefined {
  const snapshot = object(value);
  const thermal = snapshot?.thermalState;
  return snapshot && typeof snapshot.availableStorageBytes === "number" &&
    typeof snapshot.observedAtEpochMs === "number" &&
    Number.isFinite(snapshot.availableStorageBytes) && snapshot.availableStorageBytes >= 0 &&
    Number.isFinite(snapshot.observedAtEpochMs) && snapshot.observedAtEpochMs >= 0 &&
    (thermal === "nominal" || thermal === "light" || thermal === "moderate" || thermal === "severe" || thermal === "critical")
    ? { availableStorageBytes: snapshot.availableStorageBytes, observedAtEpochMs: snapshot.observedAtEpochMs, thermalState: thermal }
    : undefined;
}

function recoveredJobs(value: unknown): readonly MediaJobState[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const states = value.map(mediaJobState);
  return states.every((state): state is MediaJobState => state !== undefined)
    ? states
    : undefined;
}

function verifiedApk(value: unknown): VerifiedApk | undefined {
  const apk = object(value);
  const applicationId = apk ? nonEmptyString(apk.applicationId) : undefined;
  const artifactUri = apk ? nonEmptyString(apk.artifactUri) : undefined;
  const signerSha256 = apk ? sha256(apk.signerSha256) : undefined;
  const digest = apk ? sha256(apk.sha256) : undefined;
  return apk && applicationId && artifactUri && signerSha256 && digest &&
    typeof apk.versionCode === "number" && Number.isSafeInteger(apk.versionCode) && apk.versionCode >= 0
    ? { applicationId, artifactUri, signerSha256, sha256: digest, versionCode: apk.versionCode }
    : undefined;
}

function installHandoff(value: unknown): PackageInstallHandoff | undefined {
  const handoff = object(value);
  const artifactUri = handoff ? nonEmptyString(handoff.artifactUri) : undefined;
  return handoff && artifactUri && (handoff.state === "requested" || handoff.state === "awaiting-user-action")
    ? { artifactUri, state: handoff.state }
    : undefined;
}

export function createAndroidPlaybackContractPort(reader: ExpoBindingReader<ExpoPlaybackBinding>): AndroidPlaybackContractPort {
  return {
    readiness: () => readiness("playback", reader),
    startFocusedSession: (request) => invoke("playback", reader, (binding) => binding.startFocusedSession(request), (value) => {
      const state = playbackState(value);
      return state?.sessionId === request.sessionId ? state : undefined;
    }),
    enterPictureInPicture: (sessionId) => invoke("playback", reader, (binding) => binding.enterPictureInPicture(sessionId), (value) => {
      const state = playbackState(value);
      return state?.sessionId === sessionId ? state : undefined;
    }),
    endFocusedSession: (sessionId) => invoke("playback", reader, (binding) => binding.endFocusedSession(sessionId), (value) => {
      const state = playbackState(value);
      return state?.sessionId === sessionId ? state : undefined;
    }),
  };
}

export function createAndroidMediaJobsContractPort(reader: ExpoBindingReader<ExpoMediaJobsBinding>): AndroidMediaJobsContractPort {
  return {
    readiness: () => readiness("media-jobs", reader),
    startRecoverableJob: (request) => invoke("media-jobs", reader, (binding) => binding.startRecoverableJob(request), (value) => {
      const state = mediaJobState(value);
      return state?.jobId === request.jobId && state.kind === request.kind ? state : undefined;
    }),
    recoverJobs: () => invoke("media-jobs", reader, (binding) => binding.recoverJobs(), recoveredJobs),
    cancelRecoverableJob: (jobId) => invoke("media-jobs", reader, (binding) => binding.cancelRecoverableJob(jobId), (value) => {
      const state = mediaJobState(value);
      return state?.jobId === jobId ? state : undefined;
    }),
  };
}

export function createAndroidCaptionsContractPort(reader: ExpoBindingReader<ExpoCaptionsBinding>): AndroidCaptionsContractPort {
  return {
    readiness: () => readiness("captions", reader),
    installEnglishModel: (request) => invoke("captions", reader, (binding) => binding.installEnglishModel(request), captionModelState),
    removeEnglishModel: (request) => invoke("captions", reader, (binding) => binding.removeEnglishModel(request), captionModelState),
    startFocusedCaptionSession: (request) => invoke("captions", reader, (binding) => binding.startFocusedCaptionSession(request), (value) => {
      const state = captionSessionState(value);
      return state?.sessionId === request.sessionId ? state : undefined;
    }),
    stopFocusedCaptionSession: (sessionId) => invoke("captions", reader, (binding) => binding.stopFocusedCaptionSession(sessionId), (value) => {
      const state = captionSessionState(value);
      return state?.sessionId === sessionId ? state : undefined;
    }),
  };
}

export function createAndroidDiagnosticsContractPort(reader: ExpoBindingReader<ExpoDiagnosticsBinding>): AndroidDiagnosticsContractPort {
  return {
    readiness: () => readiness("diagnostics", reader),
    readResourceSnapshot: () => invoke("diagnostics", reader, (binding) => binding.readResourceSnapshot(), resourceSnapshot),
  };
}

export function createAndroidMaintenanceContractPort(reader: ExpoBindingReader<ExpoMaintenanceBinding>): AndroidMaintenanceContractPort {
  return {
    readiness: () => readiness("maintenance", reader),
    verifyDownloadedApk: (request) => invoke("maintenance", reader, (binding) => binding.verifyDownloadedApk(request), (value) => {
      const apk = verifiedApk(value);
      return apk?.artifactUri === request.artifactUri && apk.applicationId === request.expectedApplicationId && apk.sha256 === request.expectedSha256 && apk.signerSha256 === request.expectedSignerSha256 && apk.versionCode >= request.minimumVersionCode ? apk : undefined;
    }),
    handoffVerifiedApk: (apk) => invoke("maintenance", reader, (binding) => binding.handoffVerifiedApk(apk), (value) => {
      const handoff = installHandoff(value);
      return handoff?.artifactUri === apk.artifactUri ? handoff : undefined;
    }),
  };
}
