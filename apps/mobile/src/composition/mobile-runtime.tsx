import { PLATFORMS } from "@streamfusion/core/platform";

import { createExpoAppLinkSource } from "@mobile/adapters/expo-app-link-adapter";
import { createExpoAppMetadataReader } from "@mobile/adapters/expo-app-metadata-reader";
import { createDevelopmentClientController } from "@mobile/features/development/development-client-controller";
import { usePersistenceController } from "@mobile/features/development/persistence-controller";
import { AppShell } from "@mobile/features/shell/app-shell";
import { createExpoSecureRandomSource } from "@mobile/native/expo-secure-random-source";
import { createExpoSecureSecretStore } from "@mobile/native/expo-secure-secret-store";
import { createSqliteEncryptedDatabaseDriver } from "@mobile/persistence/sqlite-encrypted-driver";
import { createMobileStoreRuntime } from "@mobile/persistence/store-runtime";
import { createVolatilePersistenceProbe } from "@mobile/persistence/volatile-runtime-probe";
import { createFetchRuntimeProbe } from "@mobile/transport/fetch-runtime-probe";

const developmentClientController = createDevelopmentClientController({
  appMetadata: createExpoAppMetadataReader(),
  runtimeProbes: [createFetchRuntimeProbe(), createVolatilePersistenceProbe()],
  supportedPlatforms: PLATFORMS,
});

const persistenceRuntime = createMobileStoreRuntime({
  backupExcluded: true,
  databaseDriver: createSqliteEncryptedDatabaseDriver(),
  random: createExpoSecureRandomSource(),
  secretStore: createExpoSecureSecretStore(),
});

const appLinks = createExpoAppLinkSource();

export function MobileRuntime() {
  const persistence = usePersistenceController(persistenceRuntime);
  return (
    <AppShell
      activityRepository={persistenceRuntime.productState.activity}
      appLinks={appLinks}
      developmentStatus={developmentClientController.read()}
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
