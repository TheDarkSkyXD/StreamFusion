import {
  createAndroidCaptionsContractPort,
  createAndroidDiagnosticsContractPort,
  createAndroidMaintenanceContractPort,
  createAndroidMediaJobsContractPort,
  createAndroidPlaybackContractPort,
} from "../adapters/android-capability-contracts";
import {
  expoCaptionsBindingReader,
  expoDiagnosticsBindingReader,
  expoMaintenanceBindingReader,
  expoMediaJobsBindingReader,
  expoPlaybackBindingReader,
} from "../adapters/expo-capability-contracts";
import type { AndroidCapabilityContracts } from "../capabilities/android-capability-contracts";
import { createAndroidCapabilityStubProof } from "../domain/android-capability-stub-proof";

export function createAndroidCapabilityContractRuntime(): {
  readonly contracts: AndroidCapabilityContracts;
  readonly runStubProof: () => Promise<{
    readonly detail: string;
    readonly kind: "contained" | "safe-stubs";
  }>;
} {
  const contracts: AndroidCapabilityContracts = {
    captions: createAndroidCaptionsContractPort(expoCaptionsBindingReader),
    diagnostics: createAndroidDiagnosticsContractPort(expoDiagnosticsBindingReader),
    maintenance: createAndroidMaintenanceContractPort(expoMaintenanceBindingReader),
    mediaJobs: createAndroidMediaJobsContractPort(expoMediaJobsBindingReader),
    playback: createAndroidPlaybackContractPort(expoPlaybackBindingReader),
  };
  return { contracts, runStubProof: createAndroidCapabilityStubProof(contracts).run };
}
