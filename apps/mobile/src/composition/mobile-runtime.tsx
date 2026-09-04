import { PLATFORMS } from "@streamfusion/core/platform";

import { createExpoAppMetadataReader } from "@mobile/adapters/expo-app-metadata-reader";
import { createDevelopmentClientController } from "@mobile/features/development/development-client-controller";
import { AppShell } from "@mobile/features/shell/app-shell";
import { createVolatilePersistenceProbe } from "@mobile/persistence/volatile-runtime-probe";
import { createFetchRuntimeProbe } from "@mobile/transport/fetch-runtime-probe";

const developmentClientController = createDevelopmentClientController({
  appMetadata: createExpoAppMetadataReader(),
  runtimeProbes: [createFetchRuntimeProbe(), createVolatilePersistenceProbe()],
  supportedPlatforms: PLATFORMS,
});

export function MobileRuntime() {
  return <AppShell developmentStatus={developmentClientController.read()} />;
}
