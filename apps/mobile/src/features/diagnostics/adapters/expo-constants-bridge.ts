import Constants from "expo-constants";

export interface ExpoConstantsSnapshot {
  readonly appName: string | null;
  readonly appOwnership: string | null;
  readonly appVersion: string | null;
  readonly executionEnvironment: string;
}

export function readExpoConstants(): ExpoConstantsSnapshot {
  return {
    appName: Constants.expoConfig?.name ?? null,
    appOwnership: Constants.appOwnership,
    appVersion: Constants.expoConfig?.version ?? null,
    executionEnvironment: Constants.executionEnvironment,
  };
}
