import type {
  AndroidNativeFailure,
  AndroidNativeOperationResult,
  AndroidPlaybackContractPort,
  PlaybackQualityCatalog,
  PlaybackSessionState,
} from "@mobile/features/native-contracts/capabilities/android-capability-contracts";

import type {
  FocusedPlaybackControlResult,
  FocusedPlaybackFailure,
  FocusedPlaybackPort,
  FocusedPlaybackQualityResult,
  FocusedPictureInPictureResult,
} from "../../capabilities/watch";

export function createAndroidFocusedPlaybackPort(
  contract: AndroidPlaybackContractPort,
): FocusedPlaybackPort {
  return {
    async start(input) {
      const result = await contract.startFocusedSession({
        requestHeaders: input.requestHeaders,
        sessionId: input.sessionId,
        sourceUri: input.sourceUri,
      });
      if (result.kind === "completed") {
        return { kind: "started", session: result.value };
      }
      return { failure: mapFailure(result.failure), kind: "unavailable" };
    },
    async end(sessionId) {
      const result = await contract.endFocusedSession(sessionId);
      if (result.kind === "completed") {
        return result.value.kind === "missing"
          ? { kind: "missing", sessionId }
          : { kind: "ended", sessionId };
      }
      return { failure: mapFailure(result.failure), kind: "unavailable" };
    },
    enterPictureInPicture: async (sessionId) =>
      mapPictureInPicture(await contract.enterPictureInPicture(sessionId)),
    listQualities: async (sessionId) =>
      mapQuality(sessionId, await contract.listQualities(sessionId)),
    setMuted: async (sessionId, muted) =>
      mapControl(sessionId, await contract.setMuted(sessionId, muted)),
    setPlaying: async (sessionId, playing) =>
      mapControl(sessionId, await contract.setPlaying(sessionId, playing)),
    setQuality: async (sessionId, quality) =>
      mapQuality(sessionId, await contract.setQuality(sessionId, quality)),
    setVolume: async (sessionId, volume) =>
      mapControl(sessionId, await contract.setVolume(sessionId, volume)),
    subscribe(listener) {
      return contract.subscribe(listener);
    },
  };
}

function mapControl(
  _sessionId: string,
  result: AndroidNativeOperationResult<PlaybackSessionState>,
): FocusedPlaybackControlResult {
  if (result.kind === "completed") {
    return { kind: "applied", session: result.value };
  }
  if (result.kind === "unsupported") {
    return { failure: mapFailure(result.failure), kind: "unavailable" };
  }
  return { failure: mapFailure(result.failure), kind: "unavailable" };
}

function mapQuality(
  sessionId: string,
  result: AndroidNativeOperationResult<PlaybackQualityCatalog>,
): FocusedPlaybackQualityResult {
  if (result.kind === "completed") {
    return { catalog: result.value, kind: "listed" };
  }
  return { failure: mapFailure(result.failure), kind: "unavailable" };
}

function mapPictureInPicture(
  result: AndroidNativeOperationResult<PlaybackSessionState>,
): FocusedPictureInPictureResult {
  if (result.kind === "completed") {
    return { kind: "entered", session: result.value };
  }
  if (result.kind === "unsupported") {
    return { failure: mapFailure(result.failure), kind: "unsupported" };
  }
  return { failure: mapFailure(result.failure), kind: "unavailable" };
}

function mapFailure(failure: AndroidNativeFailure): FocusedPlaybackFailure {
  if (failure.code === "NATIVE_BINDING_UNAVAILABLE") {
    return { code: "BINDING_UNAVAILABLE", detail: failure.diagnostic };
  }
  if (failure.code === "NATIVE_CONTRACT_VERSION_UNSUPPORTED") {
    return { code: "CONTRACT_UNSUPPORTED", detail: failure.diagnostic };
  }
  if (failure.code === "NATIVE_OPERATION_UNSUPPORTED") {
    return { code: "OPERATION_UNSUPPORTED", detail: failure.diagnostic };
  }
  if (failure.code === "NATIVE_INVOCATION_FAILED") {
    return { code: "INVOCATION_FAILED", detail: failure.diagnostic };
  }
  return { code: "RESULT_INVALID", detail: failure.diagnostic };
}
