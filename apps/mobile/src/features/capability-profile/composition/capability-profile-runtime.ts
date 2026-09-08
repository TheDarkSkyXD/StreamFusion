import type { AndroidDiagnosticsContractPort } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
import type { CapabilityProfileSnapshotStore } from "@mobile/features/storage/capabilities/persistence";

import {
  createAndroidRuntimeObservationDevelopmentProof,
  createAndroidRuntimeObservationReader,
} from "../adapters/android-runtime-observation-reader";
import { createProductCapabilityProfileStore } from "../data/product-capability-profile-store";

export function createCapabilityProfileRuntime(options: {
  readonly diagnostics: AndroidDiagnosticsContractPort;
  readonly store: CapabilityProfileSnapshotStore;
}) {
  return {
    developmentProof: createAndroidRuntimeObservationDevelopmentProof(options.diagnostics),
    observationReader: createAndroidRuntimeObservationReader(options.diagnostics),
    store: createProductCapabilityProfileStore(options.store),
  };
}
