import type {
  AppMetadataReader,
  MobileRuntimeHost,
} from "@mobile/features/diagnostics/capabilities/app-metadata";
import {
  readAndroidAppMetadata,
  type AndroidAppMetadataSnapshot,
} from "@mobile/features/diagnostics/adapters/android-app-metadata";

function getRuntimeHost(snapshot: AndroidAppMetadataSnapshot): MobileRuntimeHost {
  return snapshot.executionEnvironment;
}

export function createAndroidAppMetadataReader(): AppMetadataReader {
  return {
    read() {
      const snapshot = readAndroidAppMetadata();
      return {
        name: snapshot.appName ?? "StreamFusion Mobile",
        version: snapshot.appVersion ?? "development",
        runtimeHost: getRuntimeHost(snapshot),
      };
    },
  };
}
