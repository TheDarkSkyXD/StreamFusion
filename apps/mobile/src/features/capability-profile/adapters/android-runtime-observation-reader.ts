import type { AndroidDiagnosticsContractPort } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";

import type {
  RuntimeObservationReader,
  RuntimeObservationDevelopmentProof,
  RuntimeObservationDevelopmentProofResult,
  RuntimeObservationResult,
} from "../capabilities/capability-profile";

function resultDetail(result: Exclude<Awaited<ReturnType<AndroidDiagnosticsContractPort["readResourceSnapshot"]>>, { readonly kind: "completed" }>): string {
  return result.failure.diagnostic;
}

export function createAndroidRuntimeObservationReader(
  diagnostics: AndroidDiagnosticsContractPort,
): RuntimeObservationReader {
  return {
    async read(): Promise<RuntimeObservationResult> {
      const result = await diagnostics.readResourceSnapshot();
      return result.kind === "completed"
        ? { kind: "observed", snapshot: result.value }
        : { detail: resultDetail(result), kind: "unavailable" };
    },
  };
}

export function createAndroidRuntimeObservationDevelopmentProof(
  diagnostics: AndroidDiagnosticsContractPort,
): RuntimeObservationDevelopmentProof {
  return {
    async queueNextNativeReadFailure(): Promise<RuntimeObservationDevelopmentProofResult> {
      const result = await diagnostics.queueDevelopmentResourceSnapshotFailure();
      return result.kind === "completed"
        ? { kind: "queued" }
        : { detail: resultDetail(result), kind: "unavailable" };
    },
  };
}
