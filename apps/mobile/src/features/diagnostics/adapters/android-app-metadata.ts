import { getPlatformModule } from "../../../../modules/streamfusion-native-contracts/src/platform";

export interface AndroidAppMetadataSnapshot {
  readonly appName: string | null;
  readonly appVersion: string | null;
  readonly executionEnvironment: "bare";
}

export function readAndroidAppMetadata(): AndroidAppMetadataSnapshot {
  const platform = getPlatformModule();
  return {
    appName: platform.appName,
    appVersion: platform.appVersion,
    executionEnvironment: platform.runtimeHost,
  };
}
