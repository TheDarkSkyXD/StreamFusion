import type {
  AppMetadataReader,
  MobileRuntimeHost,
} from "@mobile/capabilities/app-metadata";
import {
  readExpoConstants,
  type ExpoConstantsSnapshot,
} from "@mobile/native/expo-constants-bridge";

function getRuntimeHost(snapshot: ExpoConstantsSnapshot): MobileRuntimeHost {
  if (snapshot.appOwnership === "expo") return "expo-go";
  if (snapshot.executionEnvironment === "storeClient") {
    return "development-client";
  }
  if (snapshot.executionEnvironment === "bare") return "bare";
  return "standalone";
}

export function createExpoAppMetadataReader(): AppMetadataReader {
  return {
    read() {
      const snapshot = readExpoConstants();
      return {
        name: snapshot.appName ?? "StreamFusion Mobile",
        version: snapshot.appVersion ?? "development",
        runtimeHost: getRuntimeHost(snapshot),
      };
    },
  };
}
