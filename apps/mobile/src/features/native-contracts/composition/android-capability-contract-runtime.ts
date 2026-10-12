import {
  createAndroidCaptionsContractPort,
  createAndroidDiagnosticsContractPort,
  createAndroidMaintenanceContractPort,
  createAndroidMediaJobsContractPort,
  createAndroidPlaybackContractPort,
} from "../adapters/android-capability-contracts";
import {
  androidCaptionsBindingReader,
  androidDiagnosticsBindingReader,
  androidMaintenanceBindingReader,
  androidMediaJobsBindingReader,
  androidPlaybackBindingReader,
} from "../adapters/react-native-capability-bindings";
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
    captions: createAndroidCaptionsContractPort(androidCaptionsBindingReader),
    diagnostics: createAndroidDiagnosticsContractPort(androidDiagnosticsBindingReader),
    maintenance: createAndroidMaintenanceContractPort(androidMaintenanceBindingReader),
    mediaJobs: createAndroidMediaJobsContractPort(androidMediaJobsBindingReader),
    playback: createAndroidPlaybackContractPort(androidPlaybackBindingReader),
  };
  return { contracts, runStubProof: createAndroidCapabilityStubProof(contracts).run };
}
