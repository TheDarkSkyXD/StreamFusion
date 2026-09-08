import { PLATFORMS } from "@streamfusion/core/platform";

import { createExpoAppLinkSource } from "@mobile/features/shell/adapters/expo-app-link-adapter";
import { createExpoAppMetadataReader } from "@mobile/features/diagnostics/adapters/expo-app-metadata-reader";
import { createAndroidCapabilityContractRuntime } from "@mobile/features/native-contracts/composition/android-capability-contract-runtime";
import { createCapabilityProfileRuntime } from "@mobile/features/capability-profile/composition/capability-profile-runtime";
import { useCapabilityProfileController } from "@mobile/features/capability-profile/components/use-capability-profile-controller";
import {
  createInstallationPolicyRuntime,
  publicProductionConfigurationFromEnvironment,
} from "@mobile/features/installation-policy/composition/installation-policy-runtime";
import { useInstallationPolicyController } from "@mobile/features/installation-policy/components/use-installation-policy-controller";
import { createDevelopmentClientController } from "@mobile/features/diagnostics/domain/development-client-controller";
import { usePersistenceController } from "@mobile/features/diagnostics/components/persistence-controller";
import { AppShell } from "@mobile/features/shell/components/app-shell";
import { createExpoSecureRandomSource } from "@mobile/features/storage/adapters/expo-secure-random-source";
import { createExpoSecureSecretStore } from "@mobile/features/storage/adapters/expo-secure-secret-store";
import { createSqliteEncryptedDatabaseDriver } from "@mobile/features/storage/adapters/sqlite-encrypted-driver";
import { createMobileStoreRuntime } from "@mobile/features/storage/composition/store-runtime";
import { createVolatilePersistenceProbe } from "@mobile/features/diagnostics/adapters/volatile-persistence-probe";
import { createFetchRuntimeProbe } from "@mobile/features/diagnostics/adapters/fetch-runtime-probe";

const androidCapabilityRuntime = createAndroidCapabilityContractRuntime();

const developmentClientController = createDevelopmentClientController({
  appMetadata: createExpoAppMetadataReader(),
  nativeCapabilityContracts: Object.values(androidCapabilityRuntime.contracts),
  runtimeProbes: [createFetchRuntimeProbe(), createVolatilePersistenceProbe()],
  supportedPlatforms: PLATFORMS,
});

const secureRandom = createExpoSecureRandomSource();
const secureSecretStore = createExpoSecureSecretStore();

const persistenceRuntime = createMobileStoreRuntime({
  backupExcluded: true,
  databaseDriver: createSqliteEncryptedDatabaseDriver(),
  random: secureRandom,
  secretStore: secureSecretStore,
});

const appLinks = createExpoAppLinkSource();

const capabilityProfileRuntime = createCapabilityProfileRuntime({
  diagnostics: androidCapabilityRuntime.contracts.diagnostics,
  store: persistenceRuntime.productState.capabilityProfile,
});

const installationPolicyRuntime = createInstallationPolicyRuntime({
  productionConfiguration: publicProductionConfigurationFromEnvironment({
    relayUrl: process.env.EXPO_PUBLIC_STREAMFUSION_RELAY_URL,
    trustedKeysJson: process.env.EXPO_PUBLIC_STREAMFUSION_POLICY_TRUSTED_KEYS,
  }),
  random: secureRandom,
  secretStore: secureSecretStore,
  identityPresenceStore: persistenceRuntime.productState.installationIdentityPresence,
  snapshotStore: persistenceRuntime.productState.installationPolicy,
});

export function MobileRuntime() {
  const persistence = usePersistenceController(persistenceRuntime);
  const capabilityProfile = useCapabilityProfileController(
    capabilityProfileRuntime,
  );
  const installationPolicy = useInstallationPolicyController(
    installationPolicyRuntime,
  );
  return (
    <AppShell
      activityRepository={persistenceRuntime.productState.activity}
      appLinks={appLinks}
      capabilityProfile={capabilityProfile.model}
      onRetryCapabilityProfile={capabilityProfile.retry}
      installationPolicy={installationPolicy.model}
      onRefreshCapabilityPolicy={installationPolicy.refreshCapabilityPolicy}
      onRetryInstallationRegistration={
        installationPolicy.retryInstallationRegistration
      }
      onRunCapabilityProfileDevelopmentProof={() =>
        capabilityProfileRuntime.developmentProof.queueNextNativeReadFailure()
      }
      developmentStatus={developmentClientController.read()}
      onRunNativeCapabilityProof={androidCapabilityRuntime.runStubProof}
      onPrepareRestorationProof={async (kind) => {
        await persistenceRuntime.productState.shellRestoration.write(
          kind === "corrupt" ? "not-json" : JSON.stringify({ version: 2 }),
          Date.now(),
        );
      }}
      onRunPersistenceProof={persistence.runProof}
      persistenceStatus={persistence.model}
      shellRestoration={persistenceRuntime.productState.shellRestoration}
    />
  );
}
