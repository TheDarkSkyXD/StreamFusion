import type { Platform } from "@streamfusion/core/platform";

import type { AppMetadataReader } from "@mobile/features/diagnostics/capabilities/app-metadata";
import type { RuntimeProbe } from "@mobile/features/diagnostics/capabilities/runtime-readiness";
import type { AndroidCapabilityContractPort } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";

export interface DevelopmentClientViewModel {
  readonly providerStatus: string;
  readonly layerStatus: string;
  readonly nativeCapabilityStatus: string;
  readonly runtimeStatus: string;
  readonly title: string;
  readonly version: string;
}

export interface DevelopmentClientController {
  read(): DevelopmentClientViewModel;
}

export function createDevelopmentClientController(options: {
  readonly appMetadata: AppMetadataReader;
  readonly nativeCapabilityContracts: readonly AndroidCapabilityContractPort[];
  readonly runtimeProbes: readonly RuntimeProbe[];
  readonly supportedPlatforms: readonly Platform[];
}): DevelopmentClientController {
  return {
    read() {
      const metadata = options.appMetadata.read();
      const layerStates = options.runtimeProbes.map((probe) => probe.check());
      const unavailableLayers = layerStates.filter(
        (state) => state.kind === "unavailable",
      );
      const nativeStates = options.nativeCapabilityContracts.map((contract) =>
        contract.readiness(),
      );
      const unavailableNativeCapabilities = nativeStates.filter(
        (state) => state.kind === "unavailable",
      );
      const runtimeName =
        metadata.runtimeHost === "expo-go"
          ? "Expo Go"
          : metadata.runtimeHost.replaceAll("-", " ");
      return {
        title: metadata.name,
        version: `Version ${metadata.version}`,
        runtimeStatus: `Android ${runtimeName} runtime is composed.`,
        providerStatus: `${options.supportedPlatforms.length} provider contracts ready.`,
        layerStatus:
          unavailableLayers.length === 0
            ? `${layerStates.length}/${layerStates.length} runtime services ready.`
            : unavailableLayers.map((state) => state.reason).join(" "),
        nativeCapabilityStatus:
          unavailableNativeCapabilities.length === 0
            ? `${nativeStates.length}/${nativeStates.length} Android module contracts available. Capability behavior is not enabled by this check.`
            : unavailableNativeCapabilities
                .map((state) => state.failure.diagnostic)
                .join(" "),
      };
    },
  };
}
