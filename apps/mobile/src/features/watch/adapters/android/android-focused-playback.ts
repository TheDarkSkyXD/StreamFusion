import type {
  AndroidNativeFailure,
  AndroidPlaybackContractPort,
} from "@mobile/features/native-contracts/capabilities/android-capability-contracts";

import type {
  FocusedPlaybackFailure,
  FocusedPlaybackPort,
} from "../../capabilities/watch";

export function createAndroidFocusedPlaybackPort(
  contract: AndroidPlaybackContractPort,
): FocusedPlaybackPort {
  return {
    async start(input) {
      const result = await contract.startFocusedSession({
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
    subscribe(listener) {
      return contract.subscribe(listener);
    },
  };
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
