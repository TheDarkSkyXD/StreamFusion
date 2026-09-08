import type { AndroidResourceSnapshot } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";

export type RuntimeObservationResult =
  | { readonly kind: "observed"; readonly snapshot: AndroidResourceSnapshot }
  | { readonly detail: string; readonly kind: "unavailable" };

export interface RuntimeObservationReader {
  read(): Promise<RuntimeObservationResult>;
}

export type RuntimeObservationDevelopmentProofResult =
  | { readonly kind: "queued" }
  | { readonly detail: string; readonly kind: "unavailable" };

export interface RuntimeObservationDevelopmentProof {
  queueNextNativeReadFailure(): Promise<RuntimeObservationDevelopmentProofResult>;
}

export interface CapabilityProfileStore {
  read(): Promise<string | null>;
  write(serializedProfile: string, observedAtEpochMs: number): Promise<void>;
}
