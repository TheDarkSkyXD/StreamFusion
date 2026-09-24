import {
  LOCAL_CAPTION_DISPLAY_SIZE,
  LOCAL_CAPTION_DOWNLOAD_BYTES,
  LOCAL_CAPTION_LICENSE,
  LOCAL_CAPTION_LANGUAGE_LABEL,
  LOCAL_CAPTION_NOT_INSTALLED_STATUS,
  LOCAL_CAPTION_READY_STATUS,
} from "@streamfusion/core/local-captions";
import {
  parseMediaJobFileEvidence,
  parseMediaJobNativeJournal,
} from "@streamfusion/core/media-jobs";

import type {
  AndroidCaptionsContractPort,
  NativePlaybackEvent,
  NativePlaybackFailureCode,
  PlaybackEndState,
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
  CaptionModelPhase,
  CaptionModelState,
  CaptionProofState,
  CaptionSessionPhase,
  CaptionSessionState,
  NativeCaptionEvent,
  MediaJobDeleteNativeResult,
  MediaJobExportNativeResult,
  MediaJobKind,
  MediaJobNativeResult,
  MediaJobOpenNativeResult,
  PackageInstallHandoff,
  PlaybackQualityCatalog,
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
  if (
    capability === "diagnostics" ||
    capability === "playback" ||
    capability === "media-jobs"
  ) {
    return 3;
  }
  if (capability === "captions") return 2;
  return 1;
}

function resolveBinding<
  TBinding extends { readonly getContractVersion: () => number },
>(
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

function readiness<
  TBinding extends { readonly getContractVersion: () => number },
>(
  capability: AndroidCapabilityId,
  reader: ExpoBindingReader<TBinding>,
): AndroidCapabilityReadiness {
  const resolution = resolveBinding(capability, reader);
  return resolution.kind === "available"
    ? {
        capability,
        contractVersion: expectedContractVersion(capability),
        kind: "ready",
      }
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

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sha256(value: unknown): string | undefined {
  const digest = nonEmptyString(value);
  return digest && /^[a-f0-9]{64}$/iu.test(digest) ? digest : undefined;
}

function unsupported(value: unknown): string | undefined {
  const response = object(value);
  return response &&
    response.kind === "unsupported" &&
    response.code === "NATIVE_OPERATION_UNSUPPORTED" &&
    typeof response.diagnostic === "string" &&
    response.diagnostic.length > 0
    ? response.diagnostic
    : undefined;
}

function completed<TValue>(
  value: unknown,
  parse: (candidate: unknown) => TValue | undefined,
): TValue | undefined {
  const response = object(value);
  return response && response.kind === "completed"
    ? parse(response.value)
    : undefined;
}

async function invoke<
  TBinding extends { readonly getContractVersion: () => number },
  TValue,
>(
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

function playbackQualities(value: unknown): PlaybackQualityCatalog | undefined {
  const state = object(value);
  const sessionId = state ? nonEmptyString(state.sessionId) : undefined;
  const selected = state ? nonEmptyString(state.selected) : undefined;
  const qualities = state && Array.isArray(state.qualities)
    ? state.qualities.filter((item): item is string => typeof item === "string" && item.length > 0)
    : undefined;
  return state && sessionId && selected && qualities && qualities.length > 0
    ? { qualities, selected, sessionId }
    : undefined;
}

function playbackState(value: unknown): PlaybackSessionState | undefined {
  const state = object(value);
  const sessionId = state ? nonEmptyString(state.sessionId) : undefined;
  return state &&
    sessionId &&
    typeof state.pictureInPictureEligible === "boolean"
    ? { sessionId, pictureInPictureEligible: state.pictureInPictureEligible }
    : undefined;
}

function playbackEndState(
  sessionId: string,
  value: unknown,
): PlaybackEndState | undefined {
  const result = object(value);
  if (!result) return undefined;
  if (result.kind === "missing") {
    const missingId = nonEmptyString(result.sessionId);
    return missingId === sessionId ? { kind: "missing", sessionId } : undefined;
  }
  if (result.kind === "ended") {
    const state = playbackState(result.state);
    return state?.sessionId === sessionId ? { kind: "ended", state } : undefined;
  }
  return undefined;
}

const PLAYBACK_FAILURE_CODES: readonly NativePlaybackFailureCode[] = [
  "PLAYBACK_DECODER_UNSUPPORTED",
  "PLAYBACK_NETWORK_FAILED",
  "PLAYBACK_SOURCE_REJECTED",
  "PLAYBACK_UNKNOWN",
];

function nativePlaybackEvent(value: unknown): NativePlaybackEvent | undefined {
  const event = object(value);
  const sessionId = event ? nonEmptyString(event.sessionId) : undefined;
  if (!event || !sessionId) return undefined;
  if (event.kind === "buffering") return { kind: "buffering", sessionId };
  if (event.kind === "playing") return { kind: "playing", sessionId };
  if (event.kind === "ended") return { kind: "ended", sessionId };
  if (event.kind === "picture-in-picture-exited") {
    return { kind: "picture-in-picture-exited", sessionId };
  }
  if (event.kind === "filtering") {
    const diagnostic = nonEmptyString(event.diagnostic);
    if (!diagnostic) return undefined;
    return {
      diagnostic,
      kind: "filtering",
      sessionId,
      ...(typeof event.adsDetected === "boolean"
        ? { adsDetected: event.adsDetected }
        : {}),
    };
  }
  if (
    event.kind === "paused" &&
    (event.reason === "background" || event.reason === "user")
  ) {
    return { kind: "paused", reason: event.reason, sessionId };
  }
  if (event.kind === "progress") {
    const positionMs = finiteNumber(event.positionMs);
    const durationMs = finiteNumber(event.durationMs);
    return positionMs !== undefined && durationMs !== undefined
      ? {
          durationMs,
          kind: "progress",
          positionMs,
          seekable: event.seekable === true,
          sessionId,
        }
      : undefined;
  }
  if (event.kind === "failed") {
    const code = PLAYBACK_FAILURE_CODES.find((item) => item === event.code);
    const detail = nonEmptyString(event.detail);
    return code && detail
      ? { code, detail, kind: "failed", sessionId }
      : undefined;
  }
  return undefined;
}

function unwrapCompleted(value: unknown): unknown {
  let current = toPlainJson(value);
  for (let step = 0; step < 3; step += 1) {
    const record = object(current);
    if (!record || record.kind !== "completed") break;
    current = toPlainJson(record.value);
  }
  return current;
}

function mediaJobNativeResult(
  value: unknown,
): MediaJobNativeResult | undefined {
  const state = object(unwrapCompleted(value));
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
  return {
    kind: "record",
    journal,
    files: parseMediaJobFileEvidence(state.files),
  };
}

function captionModelPhase(value: unknown): CaptionModelPhase | undefined {
  return value === "not-installed" ||
    value === "downloading" ||
    value === "verifying" ||
    value === "ready" ||
    value === "integrity-error" ||
    value === "constrained"
    ? value
    : undefined;
}

function captionPack(value: unknown): CaptionModelState["pack"] | undefined {
  return value === "fixture" || value === "none" || value === "product"
    ? value
    : undefined;
}

function captionModelState(value: unknown): CaptionModelState | undefined {
  const state = object(value);
  if (!state || state.modelId !== "english-v1" || typeof state.installed !== "boolean") {
    return undefined;
  }
  const phase =
    captionModelPhase(state.phase) ??
    (state.installed ? "ready" : "not-installed");
  const pack = captionPack(state.pack) ?? (state.installed ? "fixture" : "none");
  const downloadedBytes = numberAtLeast(state.downloadedBytes, 0) ?? 0;
  const expectedBytes = numberAtLeast(state.expectedBytes, 0) ?? LOCAL_CAPTION_DOWNLOAD_BYTES;
  const audioUploadAttempts = numberAtLeast(state.audioUploadAttempts, 0) ?? 0;
  const displaySize =
    nonEmptyString(state.displaySize) ?? LOCAL_CAPTION_DISPLAY_SIZE;
  const license = nonEmptyString(state.license) ?? LOCAL_CAPTION_LICENSE;
  const languageLabel = nonEmptyString(state.languageLabel) ?? LOCAL_CAPTION_LANGUAGE_LABEL;
  const statusMessage =
    nonEmptyString(state.statusMessage) ??
    (state.installed
      ? LOCAL_CAPTION_READY_STATUS
      : LOCAL_CAPTION_NOT_INSTALLED_STATUS);
  return {
    audioUploadAttempts,
    displaySize,
    downloadedBytes,
    expectedBytes,
    installed: state.installed,
    languageLabel,
    license,
    modelId: "english-v1",
    pack,
    phase,
    sha256Verified: state.sha256Verified === true,
    statusMessage,
    ...(typeof state.error === "string" ? { error: state.error } : {}),
  };
}

function captionSessionPhase(value: unknown): CaptionSessionPhase | undefined {
  return value === "active" || value === "stopped" || value === "rejected"
    ? value
    : undefined;
}

function captionSessionState(value: unknown): CaptionSessionState | undefined {
  const state = object(value);
  const sessionId = state ? nonEmptyString(state.sessionId) : undefined;
  const phase = state ? captionSessionPhase(state.state) : undefined;
  if (!state || !sessionId || !phase) return undefined;
  return {
    audioLeftDevice: state.audioLeftDevice === true,
    audioUploadAttempts: numberAtLeast(state.audioUploadAttempts, 0) ?? 0,
    cueText: typeof state.cueText === "string" ? state.cueText : "",
    microphonePermissionRequested: state.microphonePermissionRequested === true,
    pcmBytesProcessed: numberAtLeast(state.pcmBytesProcessed, 0) ?? 0,
    sessionId,
    state: phase,
    ...(typeof state.reason === "string" ? { reason: state.reason } : {}),
  };
}

function captionProofState(value: unknown): CaptionProofState | undefined {
  const model = captionModelState(value);
  const session = captionSessionState(value);
  return model && session ? { ...model, ...session } : undefined;
}

function nativeCaptionEvent(value: unknown): NativeCaptionEvent | undefined {
  const state = object(value);
  const session = captionSessionState(value);
  if (!state || !session) return undefined;
  if (state.kind === "cue" || state.kind === "state") {
    return { kind: state.kind, ...session };
  }
  return undefined;
}

function resourceSnapshot(value: unknown): AndroidResourceSnapshot | undefined {
  const snapshot = object(value);
  const observedAtEpochMs = numberAtLeast(snapshot?.observedAtEpochMs, 0);
  const thermal = thermalObservation(snapshot?.thermal);
  const memory = memoryObservation(snapshot?.memory);
  const storage = storageObservation(snapshot?.storage);
  const runtime = runtimeIdentity(snapshot?.runtime);
  const decoders = decoderObservations(snapshot?.decoders);
  return snapshot &&
    observedAtEpochMs !== undefined &&
    thermal &&
    memory &&
    storage &&
    runtime &&
    decoders
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
  return value === "none" ||
    value === "light" ||
    value === "moderate" ||
    value === "severe" ||
    value === "critical" ||
    value === "emergency" ||
    value === "shutdown"
    ? value
    : undefined;
}

function thermalObservation(
  value: unknown,
): AndroidResourceSnapshot["thermal"] | undefined {
  const observation = object(value);
  const state = observation ? thermal(observation.state) : undefined;
  if (observation?.kind === "observed" && state)
    return { kind: "observed", state };
  const detail = observation ? nonEmptyString(observation.detail) : undefined;
  return observation?.kind === "unavailable" && detail
    ? { detail, kind: "unavailable" }
    : undefined;
}

function executionEnvironment(
  value: unknown,
): AndroidExecutionEnvironment | undefined {
  return value === "emulator" || value === "physical" || value === "unknown"
    ? value
    : undefined;
}

function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) &&
    value.every((item) => nonEmptyString(item) !== undefined)
    ? value
    : undefined;
}

function decoderObservations(
  value: unknown,
): readonly AndroidDecoderObservation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const decoders = value.map((candidate) => {
    const decoder = object(candidate);
    const name = decoder ? nonEmptyString(decoder.name) : undefined;
    const mimeTypes = decoder ? stringArray(decoder.mimeTypes) : undefined;
    return decoder &&
      name &&
      mimeTypes &&
      typeof decoder.hardwareAccelerated === "boolean" &&
      typeof decoder.softwareOnly === "boolean"
      ? {
          hardwareAccelerated: decoder.hardwareAccelerated,
          mimeTypes,
          name,
          softwareOnly: decoder.softwareOnly,
        }
      : undefined;
  });
  return decoders.every(
    (decoder): decoder is AndroidDecoderObservation => decoder !== undefined,
  )
    ? decoders
    : undefined;
}

function memoryObservation(
  value: unknown,
): AndroidMemoryObservation | undefined {
  const memory = object(value);
  if (!memory) return undefined;
  const availableBytes = numberAtLeast(memory.availableBytes, 0);
  const runtimeFreeBytes = numberAtLeast(memory.runtimeFreeBytes, 0);
  const runtimeMaxBytes = numberAtLeast(memory.runtimeMaxBytes, 0);
  const runtimeTotalBytes = numberAtLeast(memory.runtimeTotalBytes, 0);
  const thresholdBytes = numberAtLeast(memory.thresholdBytes, 0);
  const totalBytes = numberAtLeast(memory.totalBytes, 0);
  return availableBytes !== undefined &&
    runtimeFreeBytes !== undefined &&
    runtimeMaxBytes !== undefined &&
    runtimeTotalBytes !== undefined &&
    thresholdBytes !== undefined &&
    totalBytes !== undefined &&
    typeof memory.lowMemory === "boolean"
    ? {
        availableBytes,
        lowMemory: memory.lowMemory,
        runtimeFreeBytes,
        runtimeMaxBytes,
        runtimeTotalBytes,
        thresholdBytes,
        totalBytes,
      }
    : undefined;
}

function storageObservation(
  value: unknown,
): AndroidStorageObservation | undefined {
  const storage = object(value);
  const availableBytes = storage
    ? numberAtLeast(storage.availableBytes, 0)
    : undefined;
  const totalBytes = storage ? numberAtLeast(storage.totalBytes, 0) : undefined;
  return storage && availableBytes !== undefined && totalBytes !== undefined
    ? { availableBytes, totalBytes }
    : undefined;
}

function runtimeIdentity(value: unknown): AndroidRuntimeIdentity | undefined {
  const runtime = object(value);
  const applicationId = runtime
    ? nonEmptyString(runtime.applicationId)
    : undefined;
  const apiLevel = runtime ? numberAtLeast(runtime.apiLevel, 1) : undefined;
  const versionCode = runtime
    ? numberAtLeast(runtime.versionCode, 0)
    : undefined;
  const supportedAbis = runtime
    ? stringArray(runtime.supportedAbis)
    : undefined;
  const environment = runtime
    ? executionEnvironment(runtime.executionEnvironment)
    : undefined;
  const formFactor = runtime
    ? formFactorObservation(runtime.formFactor)
    : undefined;
  return runtime &&
    applicationId &&
    apiLevel !== undefined &&
    versionCode !== undefined &&
    supportedAbis &&
    environment &&
    formFactor
    ? {
        apiLevel,
        applicationId,
        executionEnvironment: environment,
        formFactor,
        supportedAbis,
        versionCode,
      }
    : undefined;
}

function formFactorObservation(
  value: unknown,
): AndroidFormFactorObservation | undefined {
  const formFactor = object(value);
  const uiModeType = formFactor
    ? numberAtLeast(formFactor.uiModeType, 0)
    : undefined;
  return formFactor &&
    uiModeType !== undefined &&
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

function recoveredJobs(
  value: unknown,
): readonly MediaJobNativeResult[] | undefined {
  const unwrapped = unwrapCompleted(value);
  if (!Array.isArray(unwrapped)) return undefined;
  const states = unwrapped.map(mediaJobNativeResult);
  return states.every(
    (state): state is MediaJobNativeResult => state !== undefined,
  )
    ? states
    : undefined;
}

function verifiedApk(value: unknown): VerifiedApk | undefined {
  const apk = object(value);
  const applicationId = apk ? nonEmptyString(apk.applicationId) : undefined;
  const artifactUri = apk ? nonEmptyString(apk.artifactUri) : undefined;
  const signerSha256 = apk ? sha256(apk.signerSha256) : undefined;
  const digest = apk ? sha256(apk.sha256) : undefined;
  return apk &&
    applicationId &&
    artifactUri &&
    signerSha256 &&
    digest &&
    typeof apk.versionCode === "number" &&
    Number.isSafeInteger(apk.versionCode) &&
    apk.versionCode >= 0
    ? {
        applicationId,
        artifactUri,
        signerSha256,
        sha256: digest,
        versionCode: apk.versionCode,
      }
    : undefined;
}

function installHandoff(value: unknown): PackageInstallHandoff | undefined {
  const handoff = object(value);
  const artifactUri = handoff ? nonEmptyString(handoff.artifactUri) : undefined;
  return handoff &&
    artifactUri &&
    (handoff.state === "requested" || handoff.state === "awaiting-user-action")
    ? { artifactUri, state: handoff.state }
    : undefined;
}

export function createAndroidPlaybackContractPort(
  reader: ExpoBindingReader<ExpoPlaybackBinding>,
): AndroidPlaybackContractPort {
  return {
    readiness: () => readiness("playback", reader),
    startFocusedSession: (request) =>
      invoke(
        "playback",
        reader,
        (binding) => binding.startFocusedSession(request),
        (value) => {
          const state = playbackState(value);
          return state?.sessionId === request.sessionId ? state : undefined;
        },
      ),
    enterPictureInPicture: (sessionId) =>
      invoke(
        "playback",
        reader,
        (binding) => binding.enterPictureInPicture(sessionId),
        (value) => {
          const state = playbackState(value);
          return state?.sessionId === sessionId ? state : undefined;
        },
      ),
    listQualities: (sessionId) =>
      invoke(
        "playback",
        reader,
        (binding) => binding.listQualities(sessionId),
        (value) => {
          const catalog = playbackQualities(value);
          return catalog?.sessionId === sessionId ? catalog : undefined;
        },
      ),
    setMuted: (sessionId, muted) =>
      invoke(
        "playback",
        reader,
        (binding) => binding.setMuted(sessionId, muted),
        (value) => {
          const state = playbackState(value);
          return state?.sessionId === sessionId ? state : undefined;
        },
      ),
    setPlaying: (sessionId, playing) =>
      invoke(
        "playback",
        reader,
        (binding) => binding.setPlaying(sessionId, playing),
        (value) => {
          const state = playbackState(value);
          return state?.sessionId === sessionId ? state : undefined;
        },
      ),
    setQuality: (sessionId, quality) =>
      invoke(
        "playback",
        reader,
        (binding) => binding.setQuality(sessionId, quality),
        (value) => {
          const catalog = playbackQualities(value);
          return catalog?.sessionId === sessionId ? catalog : undefined;
        },
      ),
    seekTo: (sessionId, positionMs) =>
      invoke(
        "playback",
        reader,
        (binding) => binding.seekTo(sessionId, positionMs),
        (value) => {
          const state = playbackState(value);
          return state?.sessionId === sessionId ? state : undefined;
        },
      ),
    setVolume: (sessionId, volume) =>
      invoke(
        "playback",
        reader,
        (binding) => binding.setVolume(sessionId, volume),
        (value) => {
          const state = playbackState(value);
          return state?.sessionId === sessionId ? state : undefined;
        },
      ),
    endFocusedSession: (sessionId) =>
      invoke(
        "playback",
        reader,
        (binding) => binding.endFocusedSession(sessionId),
        (value) => playbackEndState(sessionId, value),
      ),
    subscribe(listener) {
      const resolution = resolveBinding("playback", reader);
      if (resolution.kind === "unavailable" || !resolution.binding.addListener) {
        return () => undefined;
      }
      const subscription = resolution.binding.addListener(
        "onNativePlayback",
        (event) => {
          const parsed = nativePlaybackEvent(event);
          if (parsed) listener(parsed);
        },
      );
      return () => subscription.remove();
    },
  };
}

function jobResultFor(
  jobId: string,
  value: unknown,
  expectedKind?: MediaJobKind,
): MediaJobNativeResult | undefined {
  const result = mediaJobNativeResult(value);
  if (!result) return undefined;
  if (result.kind === "missing")
    return result.jobId === jobId ? result : undefined;
  if (result.journal.jobId !== jobId) return undefined;
  if (expectedKind !== undefined && result.journal.kind !== expectedKind) {
    return undefined;
  }
  return result;
}

function deleteResultFor(
  jobId: string,
  value: unknown,
): MediaJobDeleteNativeResult | undefined {
  const result = object(value);
  if (!result) return undefined;
  if (result.kind === "deleted" && result.jobId === jobId) {
    return { kind: "deleted", jobId };
  }
  if (result.kind === "missing" && result.jobId === jobId) {
    return { kind: "missing", jobId };
  }
  return undefined;
}

function exportResultFor(
  jobId: string,
  value: unknown,
): MediaJobExportNativeResult | undefined {
  const result = object(value);
  if (!result) return undefined;
  if (result.kind === "cancelled") return { kind: "cancelled" };
  if (result.kind === "unavailable" && result.jobId === jobId) {
    return { kind: "unavailable", jobId };
  }
  if (result.kind === "missing" && result.jobId === jobId) {
    return { kind: "missing", jobId };
  }
  const sourceSha256 = sha256(result.sourceSha256);
  const destinationSha256 = sha256(result.destinationSha256);
  const destinationUri = nonEmptyString(result.destinationUri);
  if (
    result.kind === "exported" &&
    result.jobId === jobId &&
    sourceSha256 &&
    destinationSha256 &&
    destinationUri &&
    typeof result.matched === "boolean"
  ) {
    return {
      kind: "exported",
      jobId,
      sourceSha256,
      destinationSha256,
      matched: result.matched,
      destinationUri,
    };
  }
  return undefined;
}

function openResultFor(
  jobId: string,
  value: unknown,
): MediaJobOpenNativeResult | undefined {
  const result = object(value);
  if (!result) return undefined;
  if (result.kind === "opened" && result.jobId === jobId) {
    return { kind: "opened", jobId };
  }
  if (result.kind === "unavailable" && result.jobId === jobId) {
    return { kind: "unavailable", jobId };
  }
  if (result.kind === "missing" && result.jobId === jobId) {
    return { kind: "missing", jobId };
  }
  return undefined;
}

export function createAndroidMediaJobsContractPort(
  reader: ExpoBindingReader<ExpoMediaJobsBinding>,
): AndroidMediaJobsContractPort {
  return {
    readiness: () => readiness("media-jobs", reader),
    startRecoverableJob: (request) =>
      invoke(
        "media-jobs",
        reader,
        (binding) => binding.startRecoverableJob(request),
        (value) => jobResultFor(request.jobId, value, request.kind),
      ),
    recoverJobs: () =>
      invoke(
        "media-jobs",
        reader,
        (binding) => binding.recoverJobs(),
        recoveredJobs,
      ),
    cancelRecoverableJob: (jobId) =>
      invoke(
        "media-jobs",
        reader,
        (binding) => binding.cancelRecoverableJob(jobId),
        (value) => jobResultFor(jobId, value),
      ),
    pauseRecoverableJob: (jobId) =>
      invoke(
        "media-jobs",
        reader,
        (binding) => binding.pauseRecoverableJob(jobId),
        (value) => jobResultFor(jobId, value),
      ),
    resumeRecoverableJob: (jobId) =>
      invoke(
        "media-jobs",
        reader,
        (binding) => binding.resumeRecoverableJob(jobId),
        (value) => jobResultFor(jobId, value),
      ),
    retryRecoverableJob: (jobId) =>
      invoke(
        "media-jobs",
        reader,
        (binding) => binding.retryRecoverableJob(jobId),
        (value) => jobResultFor(jobId, value),
      ),
    finalizeRecoverableJob: (jobId) =>
      invoke(
        "media-jobs",
        reader,
        (binding) => binding.finalizeRecoverableJob(jobId),
        (value) => jobResultFor(jobId, value),
      ),
    getRecoverableJob: (jobId) =>
      invoke(
        "media-jobs",
        reader,
        (binding) => binding.getRecoverableJob(jobId),
        (value) => jobResultFor(jobId, value),
      ),
    deleteRecoverableJob: (jobId) =>
      invoke(
        "media-jobs",
        reader,
        (binding) => binding.deleteRecoverableJob(jobId),
        (value) => deleteResultFor(jobId, value),
      ),
    exportRecoverableJob: (jobId) =>
      invoke(
        "media-jobs",
        reader,
        (binding) => binding.exportRecoverableJob(jobId),
        (value) => exportResultFor(jobId, value),
      ),
    openRecoverableJob: (jobId) =>
      invoke(
        "media-jobs",
        reader,
        (binding) => binding.openRecoverableJob(jobId),
        (value) => openResultFor(jobId, value),
      ),
  };
}

export function createAndroidCaptionsContractPort(
  reader: ExpoBindingReader<ExpoCaptionsBinding>,
): AndroidCaptionsContractPort {
  const call = <TValue>(
    operation: (binding: ExpoCaptionsBinding) => Promise<unknown>,
    parse: (candidate: unknown) => TValue | undefined,
  ): Promise<AndroidNativeOperationResult<TValue>> =>
    invoke("captions", reader, operation, parse);
  return {
    readiness: () => readiness("captions", reader),
    getEnglishModelState: () =>
      call((binding) => binding.getEnglishModelState(), captionModelState),
    installEnglishModel: (request) =>
      call((binding) => binding.installEnglishModel(request), captionModelState),
    removeEnglishModel: (request) =>
      call((binding) => binding.removeEnglishModel(request), captionModelState),
    queueDevelopmentCaptionConstraint: () =>
      call((binding) => binding.queueDevelopmentCaptionConstraint(), captionModelState),
    clearDevelopmentCaptionConstraint: () =>
      call((binding) => binding.clearDevelopmentCaptionConstraint(), captionModelState),
    startFocusedCaptionSession: (request) =>
      call(
        (binding) => binding.startFocusedCaptionSession(request),
        captionSessionFor(request.sessionId),
      ),
    stopFocusedCaptionSession: (sessionId) =>
      call(
        (binding) => binding.stopFocusedCaptionSession(sessionId),
        captionSessionFor(sessionId),
      ),
    getCaptionProof: () =>
      call((binding) => binding.getCaptionProof(), captionProofState),
    subscribe(listener) {
      const resolution = resolveBinding("captions", reader);
      if (resolution.kind === "unavailable" || !resolution.binding.addListener) {
        return () => undefined;
      }
      const subscription = resolution.binding.addListener(
        "onNativeCaptions",
        (event) => {
          const parsed = nativeCaptionEvent(event);
          if (parsed) listener(parsed);
        },
      );
      return () => subscription.remove();
    },
  };
}

function captionSessionFor(
  sessionId: string,
): (value: unknown) => CaptionSessionState | undefined {
  return (value) => {
    const state = captionSessionState(value);
    return state?.sessionId === sessionId ? state : undefined;
  };
}

export function createAndroidDiagnosticsContractPort(
  reader: ExpoBindingReader<ExpoDiagnosticsBinding>,
): AndroidDiagnosticsContractPort {
  return {
    readiness: () => readiness("diagnostics", reader),
    queueDevelopmentResourceSnapshotFailure: () =>
      invoke(
        "diagnostics",
        reader,
        (binding) => binding.queueDevelopmentResourceSnapshotFailure(),
        developmentResourceSnapshotFailureQueue,
      ),
    readResourceSnapshot: () =>
      invoke(
        "diagnostics",
        reader,
        (binding) => binding.readResourceSnapshot(),
        resourceSnapshot,
      ),
  };
}

export function createAndroidMaintenanceContractPort(
  reader: ExpoBindingReader<ExpoMaintenanceBinding>,
): AndroidMaintenanceContractPort {
  return {
    readiness: () => readiness("maintenance", reader),
    verifyDownloadedApk: (request) =>
      invoke(
        "maintenance",
        reader,
        (binding) => binding.verifyDownloadedApk(request),
        (value) => {
          const apk = verifiedApk(value);
          return apk?.artifactUri === request.artifactUri &&
            apk.applicationId === request.expectedApplicationId &&
            apk.sha256 === request.expectedSha256 &&
            apk.signerSha256 === request.expectedSignerSha256 &&
            apk.versionCode >= request.minimumVersionCode
            ? apk
            : undefined;
        },
      ),
    handoffVerifiedApk: (apk) =>
      invoke(
        "maintenance",
        reader,
        (binding) => binding.handoffVerifiedApk(apk),
        (value) => {
          const handoff = installHandoff(value);
          return handoff?.artifactUri === apk.artifactUri ? handoff : undefined;
        },
      ),
  };
}
