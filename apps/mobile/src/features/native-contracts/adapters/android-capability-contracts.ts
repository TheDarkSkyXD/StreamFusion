import {
  parseMediaJobFileEvidence,
  parseMediaJobNativeJournal,
} from "@streamfusion/core/media-jobs";

import type {
  AndroidCaptionsContractPort,
  AndroidCapabilityId,
  AndroidCapabilityReadiness,
  AndroidDecoderObservation,
  AndroidDevelopmentResourceSnapshotFailureQueue,
  AndroidDiagnosticsContractPort,
  AndroidExecutionEnvironment,
  AndroidFormFactorObservation,
  AndroidMaintenanceContractPort,
  AndroidMemoryObservation,
  AndroidMediaJobsContractPort,
  AndroidNativeFailure,
  AndroidNativeOperationResult,
  AndroidPlaybackContractPort,
  AndroidResourceSnapshot,
  AndroidRuntimeIdentity,
  AndroidStorageObservation,
  AndroidThermalState,
  CaptionModelState,
  CaptionSessionState,
  MediaJobNativeResult,
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

function expectedContractVersion(capability: AndroidCapabilityId): 1 | 2 | 3 {
  if (capability === "diagnostics") return 3;
  if (capability === "media-jobs") return 2;
  return 1;
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
  const expectedVersion = expectedContractVersion(capability);
  if (version !== expectedVersion) {
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
    ? { capability, contractVersion: expectedContractVersion(capability), kind: "ready" }
    : { capability, kind: "unavailable", failure: resolution.failure };
}

function toPlainJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(toPlainJson);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, toPlainJson(entry)]),
  );
}

function object(value: unknown): Readonly<Record<string, unknown>> | undefined {
  const plain = toPlainJson(value);
  if (plain === null || typeof plain !== "object" || Array.isArray(plain)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(plain));
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
        diagnostic: `${describe(capability)} Android work did not complete. Try this capability again.`,
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

function mediaJobNativeResult(value: unknown): MediaJobNativeResult | undefined {
  const state = object(value);
  if (!state) return undefined;
  if (state.kind === "missing") {
    const jobId = nonEmptyString(state.jobId);
    return jobId ? { kind: "missing", jobId } : undefined;
  }
  if (state.kind !== "record") return undefined;
  const journal = parseMediaJobNativeJournal(state.journal);
  if (!journal) return undefined;
  if (state.files === undefined || state.files === null) {
    return { kind: "record", journal, files: null };
  }
  const files = parseMediaJobFileEvidence(state.files);
  return files ? { kind: "record", journal, files } : undefined;
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
  const observedAtEpochMs = numberAtLeast(snapshot?.observedAtEpochMs, 0);
  const thermal = thermalObservation(snapshot?.thermal);
  const memory = memoryObservation(snapshot?.memory);
  const storage = storageObservation(snapshot?.storage);
  const runtime = runtimeIdentity(snapshot?.runtime);
  const decoders = decoderObservations(snapshot?.decoders);
  return snapshot && observedAtEpochMs !== undefined && thermal && memory && storage &&
    runtime && decoders
    ? { decoders, memory, observedAtEpochMs, runtime, storage, thermal }
    : undefined;
}

function developmentResourceSnapshotFailureQueue(
  value: unknown,
): AndroidDevelopmentResourceSnapshotFailureQueue | undefined {
  const queue = object(value);
  return queue?.queued === true ? { queued: true } : undefined;
}

function numberAtLeast(value: unknown, minimum: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum
    ? value
    : undefined;
}

function thermal(value: unknown): AndroidThermalState | undefined {
  return value === "none" || value === "light" || value === "moderate" ||
    value === "severe" || value === "critical" || value === "emergency" ||
    value === "shutdown"
    ? value
    : undefined;
}

function thermalObservation(value: unknown): AndroidResourceSnapshot["thermal"] | undefined {
  const observation = object(value);
  const state = observation ? thermal(observation.state) : undefined;
  if (observation?.kind === "observed" && state) return { kind: "observed", state };
  const detail = observation ? nonEmptyString(observation.detail) : undefined;
  return observation?.kind === "unavailable" && detail
    ? { detail, kind: "unavailable" }
    : undefined;
}

function executionEnvironment(value: unknown): AndroidExecutionEnvironment | undefined {
  return value === "emulator" || value === "physical" || value === "unknown"
    ? value
    : undefined;
}

function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => nonEmptyString(item) !== undefined)
    ? value
    : undefined;
}

function decoderObservations(value: unknown): readonly AndroidDecoderObservation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const decoders = value.map((candidate) => {
    const decoder = object(candidate);
    const name = decoder ? nonEmptyString(decoder.name) : undefined;
    const mimeTypes = decoder ? stringArray(decoder.mimeTypes) : undefined;
    return decoder && name && mimeTypes &&
      typeof decoder.hardwareAccelerated === "boolean" &&
      typeof decoder.softwareOnly === "boolean"
      ? { hardwareAccelerated: decoder.hardwareAccelerated, mimeTypes, name, softwareOnly: decoder.softwareOnly }
      : undefined;
  });
  return decoders.every(
    (decoder): decoder is AndroidDecoderObservation => decoder !== undefined,
  )
    ? decoders
    : undefined;
}

function memoryObservation(value: unknown): AndroidMemoryObservation | undefined {
  const memory = object(value);
  if (!memory) return undefined;
  const availableBytes = numberAtLeast(memory.availableBytes, 0);
  const runtimeFreeBytes = numberAtLeast(memory.runtimeFreeBytes, 0);
  const runtimeMaxBytes = numberAtLeast(memory.runtimeMaxBytes, 0);
  const runtimeTotalBytes = numberAtLeast(memory.runtimeTotalBytes, 0);
  const thresholdBytes = numberAtLeast(memory.thresholdBytes, 0);
  const totalBytes = numberAtLeast(memory.totalBytes, 0);
  return availableBytes !== undefined && runtimeFreeBytes !== undefined &&
    runtimeMaxBytes !== undefined && runtimeTotalBytes !== undefined &&
    thresholdBytes !== undefined && totalBytes !== undefined &&
    typeof memory.lowMemory === "boolean"
    ? { availableBytes, lowMemory: memory.lowMemory, runtimeFreeBytes, runtimeMaxBytes, runtimeTotalBytes, thresholdBytes, totalBytes }
    : undefined;
}

function storageObservation(value: unknown): AndroidStorageObservation | undefined {
  const storage = object(value);
  const availableBytes = storage ? numberAtLeast(storage.availableBytes, 0) : undefined;
  const totalBytes = storage ? numberAtLeast(storage.totalBytes, 0) : undefined;
  return storage && availableBytes !== undefined && totalBytes !== undefined
    ? { availableBytes, totalBytes }
    : undefined;
}

function runtimeIdentity(value: unknown): AndroidRuntimeIdentity | undefined {
  const runtime = object(value);
  const applicationId = runtime ? nonEmptyString(runtime.applicationId) : undefined;
  const apiLevel = runtime ? numberAtLeast(runtime.apiLevel, 1) : undefined;
  const versionCode = runtime ? numberAtLeast(runtime.versionCode, 0) : undefined;
  const supportedAbis = runtime ? stringArray(runtime.supportedAbis) : undefined;
  const environment = runtime
    ? executionEnvironment(runtime.executionEnvironment)
    : undefined;
  const formFactor = runtime ? formFactorObservation(runtime.formFactor) : undefined;
  return runtime && applicationId && apiLevel !== undefined &&
    versionCode !== undefined && supportedAbis && environment && formFactor
    ? { apiLevel, applicationId, executionEnvironment: environment, formFactor, supportedAbis, versionCode }
    : undefined;
}

function formFactorObservation(value: unknown): AndroidFormFactorObservation | undefined {
  const formFactor = object(value);
  const uiModeType = formFactor ? numberAtLeast(formFactor.uiModeType, 0) : undefined;
  return formFactor && uiModeType !== undefined &&
    typeof formFactor.automotive === "boolean" &&
    typeof formFactor.pc === "boolean" &&
    typeof formFactor.touchscreen === "boolean" &&
    typeof formFactor.television === "boolean" &&
    typeof formFactor.watch === "boolean"
    ? {
        automotive: formFactor.automotive,
        pc: formFactor.pc,
        touchscreen: formFactor.touchscreen,
        television: formFactor.television,
        uiModeType,
        watch: formFactor.watch,
      }
    : undefined;
}

function recoveredJobs(value: unknown): readonly MediaJobNativeResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const states = value.map(mediaJobNativeResult);
  return states.every((state): state is MediaJobNativeResult => state !== undefined)
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

function jobResultFor(jobId: string, value: unknown): MediaJobNativeResult | undefined {
  const result = mediaJobNativeResult(value);
  if (!result) return undefined;
  if (result.kind === "missing") return result.jobId === jobId ? result : undefined;
  return result.journal.jobId === jobId ? result : undefined;
}

export function createAndroidMediaJobsContractPort(reader: ExpoBindingReader<ExpoMediaJobsBinding>): AndroidMediaJobsContractPort {
  return {
    readiness: () => readiness("media-jobs", reader),
    startRecoverableJob: (request) => invoke("media-jobs", reader, (binding) => binding.startRecoverableJob(request), (value) => jobResultFor(request.jobId, value)),
    recoverJobs: () => invoke("media-jobs", reader, (binding) => binding.recoverJobs(), recoveredJobs),
    cancelRecoverableJob: (jobId) => invoke("media-jobs", reader, (binding) => binding.cancelRecoverableJob(jobId), (value) => jobResultFor(jobId, value)),
    pauseRecoverableJob: (jobId) => invoke("media-jobs", reader, (binding) => binding.pauseRecoverableJob(jobId), (value) => jobResultFor(jobId, value)),
    resumeRecoverableJob: (jobId) => invoke("media-jobs", reader, (binding) => binding.resumeRecoverableJob(jobId), (value) => jobResultFor(jobId, value)),
    retryRecoverableJob: (jobId) => invoke("media-jobs", reader, (binding) => binding.retryRecoverableJob(jobId), (value) => jobResultFor(jobId, value)),
    finalizeRecoverableJob: (jobId) => invoke("media-jobs", reader, (binding) => binding.finalizeRecoverableJob(jobId), (value) => jobResultFor(jobId, value)),
    getRecoverableJob: (jobId) => invoke("media-jobs", reader, (binding) => binding.getRecoverableJob(jobId), (value) => jobResultFor(jobId, value)),
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
    queueDevelopmentResourceSnapshotFailure: () =>
      invoke(
        "diagnostics",
        reader,
        (binding) => binding.queueDevelopmentResourceSnapshotFailure(),
        developmentResourceSnapshotFailureQueue,
      ),
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
