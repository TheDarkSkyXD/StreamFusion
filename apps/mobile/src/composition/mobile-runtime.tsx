import { PLATFORMS } from "@streamfusion/core/platform";

import { createExpoAppMetadataReader } from "@mobile/adapters/expo-app-metadata-reader";
import { createDevelopmentClientController } from "@mobile/features/development/development-client-controller";
import { DevelopmentClientScreen } from "@mobile/features/development/development-client-screen";
import { createVolatilePersistenceProbe } from "@mobile/persistence/volatile-runtime-probe";
import { createFetchRuntimeProbe } from "@mobile/transport/fetch-runtime-probe";

const developmentClientController = createDevelopmentClientController({
  appMetadata: createExpoAppMetadataReader(),
  runtimeProbes: [createFetchRuntimeProbe(), createVolatilePersistenceProbe()],
  supportedPlatforms: PLATFORMS,
});

export function MobileRuntime() {
  return <DevelopmentClientScreen model={developmentClientController.read()} />;
}
